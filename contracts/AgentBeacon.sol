// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal view of the Agent ID registry (SPACE ID Agent ID, ERC-721).
///         An address "holds an Agent ID" when balanceOf(address) > 0.
interface IAgentIDRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentBeacon — the daily check-in ritual for Agent ID holders.
///
/// @notice Holders of an Agent ID (a name.ai identity) check in once per UTC
///         day to build a streak, send one "ping" per day to fellow holders,
///         and claim soulbound milestone badges for streaks of 3 / 7 / 14 / 30
///         days. Badges are a minimal hand-written ERC-721 implemented in this
///         same contract, so badge eligibility reads streak state directly and
///         the whole product is a single verified contract.
///
/// @dev    Owner permissions: NONE. There is no owner, no admin, no pause, no
///         upgrade path and no withdraw function. The contract is non-payable
///         everywhere and never holds funds. The Agent ID registry address is
///         set once in the constructor and is immutable, so identical bytecode
///         runs on testnet (mock registry) and mainnet (real registry).
contract AgentBeacon {
    // ------------------------------------------------------------------
    // Agent ID gate
    // ------------------------------------------------------------------

    IAgentIDRegistry public immutable agentIDRegistry;

    constructor(address registry) {
        require(registry != address(0), "AgentBeacon: registry is zero address");
        agentIDRegistry = IAgentIDRegistry(registry);
    }

    function _holdsAgentID(address user) internal view returns (bool) {
        return agentIDRegistry.balanceOf(user) > 0;
    }

    /// @notice True when `user` currently holds an Agent ID.
    function holdsAgentID(address user) external view returns (bool) {
        if (user == address(0)) return false;
        return _holdsAgentID(user);
    }

    // ------------------------------------------------------------------
    // Check-in state
    // ------------------------------------------------------------------

    struct Stats {
        uint256 streak;        // current consecutive-day streak
        uint256 bestStreak;    // longest streak ever
        uint256 totalCheckIns; // lifetime check-ins
        uint256 lastCheckInDay; // UTC day number of the last check-in
        uint256 pingsSent;
        uint256 pingsReceived;
        uint256 badgesMask;    // bit i set => badge tier i held
    }

    mapping(address => Stats) private _stats;
    mapping(address => mapping(address => uint256)) public lastPingDay;

    uint256 public totalAgents;     // unique addresses that ever checked in
    uint256 public totalCheckInsAll;
    uint256 public totalPings;

    event CheckedIn(address indexed user, uint256 day, uint256 streak, uint256 totalCheckIns);
    event Pinged(address indexed from, address indexed to, uint256 day);

    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Check in for today. Agent ID holders only, once per UTC day.
    function checkIn() external {
        require(_holdsAgentID(msg.sender), "AgentBeacon: Agent ID required");
        uint256 today = _today();
        Stats storage s = _stats[msg.sender];
        require(s.lastCheckInDay != today, "AgentBeacon: already checked in today");

        if (s.totalCheckIns == 0) {
            totalAgents += 1;
        }
        if (s.lastCheckInDay == today - 1) {
            s.streak += 1;
        } else {
            s.streak = 1;
        }
        if (s.streak > s.bestStreak) {
            s.bestStreak = s.streak;
        }
        s.lastCheckInDay = today;
        s.totalCheckIns += 1;
        totalCheckInsAll += 1;

        emit CheckedIn(msg.sender, today, s.streak, s.totalCheckIns);
    }

    /// @notice Send a signal to another Agent ID holder. One ping per
    ///         sender -> target pair per UTC day. No self-pings.
    function ping(address to) external {
        require(to != address(0), "AgentBeacon: target is zero address");
        require(to != msg.sender, "AgentBeacon: cannot ping yourself");
        require(_holdsAgentID(msg.sender), "AgentBeacon: Agent ID required");
        require(_holdsAgentID(to), "AgentBeacon: target has no Agent ID");
        uint256 today = _today();
        require(lastPingDay[msg.sender][to] != today, "AgentBeacon: already pinged this agent today");

        lastPingDay[msg.sender][to] = today;
        _stats[msg.sender].pingsSent += 1;
        _stats[to].pingsReceived += 1;
        totalPings += 1;

        emit Pinged(msg.sender, to, today);
    }

    // ------------------------------------------------------------------
    // Views for the frontend
    // ------------------------------------------------------------------

    function myStats(address user)
        external
        view
        returns (
            uint256 streak,
            uint256 bestStreak,
            uint256 totalCheckIns,
            uint256 lastCheckInDay,
            uint256 pingsSent,
            uint256 pingsReceived,
            uint256 badgesMask
        )
    {
        Stats storage s = _stats[user];
        return (
            s.streak,
            s.bestStreak,
            s.totalCheckIns,
            s.lastCheckInDay,
            s.pingsSent,
            s.pingsReceived,
            s.badgesMask
        );
    }

    /// @notice The streak as of today: a streak whose last check-in was
    ///         before yesterday has already lapsed and reads as 0.
    function currentStreak(address user) external view returns (uint256) {
        Stats storage s = _stats[user];
        uint256 today = _today();
        if (s.lastCheckInDay == today || s.lastCheckInDay == today - 1) {
            return s.streak;
        }
        return 0;
    }

    // ------------------------------------------------------------------
    // Soulbound milestone badges (minimal ERC-721, non-transferable)
    //
    // Tiers by current streak: 0 "Spark" (3d), 1 "Flame" (7d),
    // 2 "Blaze" (14d), 3 "Beacon" (30d). Eligibility uses the live streak
    // (see currentStreak): claim while the streak is alive.
    // ------------------------------------------------------------------

    uint8 public constant BADGE_TIERS = 4;

    event BadgeClaimed(address indexed user, uint8 tier, uint256 tokenId);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    uint256 private _nextTokenId = 1;
    mapping(uint256 => address) private _badgeOwner;
    mapping(uint256 => uint8) private _badgeTier;
    mapping(address => uint256) private _badgeCount;

    function tierRequirement(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 3;
        if (tier == 1) return 7;
        if (tier == 2) return 14;
        if (tier == 3) return 30;
        revert("AgentBeacon: unknown badge tier");
    }

    function tierName(uint8 tier) public pure returns (string memory) {
        if (tier == 0) return "Spark";
        if (tier == 1) return "Flame";
        if (tier == 2) return "Blaze";
        if (tier == 3) return "Beacon";
        revert("AgentBeacon: unknown badge tier");
    }

    function _tierColor(uint8 tier) internal pure returns (string memory) {
        if (tier == 0) return "#fbbf24"; // amber
        if (tier == 1) return "#fb923c"; // orange
        if (tier == 2) return "#f87171"; // red
        return "#38bdf8"; // sky — the beacon light
    }

    function hasBadge(address user, uint8 tier) external view returns (bool) {
        require(tier < BADGE_TIERS, "AgentBeacon: unknown badge tier");
        return (_stats[user].badgesMask >> tier) & 1 == 1;
    }

    /// @notice Claim the badge for `tier` if your live streak qualifies and
    ///         you do not already hold it. Badges are soulbound.
    function claimBadge(uint8 tier) external returns (uint256 tokenId) {
        require(tier < BADGE_TIERS, "AgentBeacon: unknown badge tier");
        require(_holdsAgentID(msg.sender), "AgentBeacon: Agent ID required");
        Stats storage s = _stats[msg.sender];
        require((s.badgesMask >> tier) & 1 == 0, "AgentBeacon: badge already claimed");

        uint256 today = _today();
        uint256 liveStreak = (s.lastCheckInDay == today || s.lastCheckInDay == today - 1) ? s.streak : 0;
        require(liveStreak >= tierRequirement(tier), "AgentBeacon: streak too short for this badge");

        tokenId = _nextTokenId++;
        _badgeOwner[tokenId] = msg.sender;
        _badgeTier[tokenId] = tier;
        _badgeCount[msg.sender] += 1;
        s.badgesMask |= (uint256(1) << tier);

        emit Transfer(address(0), msg.sender, tokenId);
        emit BadgeClaimed(msg.sender, tier, tokenId);
    }

    // ------------------------- ERC-721 surface -------------------------

    function name() external pure returns (string memory) {
        return "Agent Beacon Badges";
    }

    function symbol() external pure returns (string memory) {
        return "BEACON";
    }

    /// @notice ERC-721 balanceOf — here: how many badges `owner` holds.
    ///         (Agent ID holding is checked on the registry, not here.)
    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "AgentBeacon: zero address");
        return _badgeCount[owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _badgeOwner[tokenId];
        require(owner != address(0), "AgentBeacon: nonexistent badge");
        return owner;
    }

    function badgeTierOf(uint256 tokenId) external view returns (uint8) {
        require(_badgeOwner[tokenId] != address(0), "AgentBeacon: nonexistent badge");
        return _badgeTier[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_badgeOwner[tokenId] != address(0), "AgentBeacon: nonexistent badge");
        return address(0); // soulbound: approvals never exist
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false; // soulbound: operator approvals never exist
    }

    // Soulbound: every transfer / approval path reverts, always.
    function approve(address, uint256) external pure {
        revert("AgentBeacon: badges are soulbound");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("AgentBeacon: badges are soulbound");
    }

    function transferFrom(address, address, uint256) external pure {
        revert("AgentBeacon: badges are soulbound");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("AgentBeacon: badges are soulbound");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("AgentBeacon: badges are soulbound");
    }

    // ------------------------- Badge metadata --------------------------

    function _badgeSVG(uint8 tier) internal pure returns (string memory) {
        string memory color = _tierColor(tier);
        string memory head = string(
            abi.encodePacked(
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'>",
                "<rect width='240' height='240' rx='24' fill='#0b1020'/>",
                "<circle cx='120' cy='104' r='58' fill='none' stroke='",
                color,
                "' stroke-width='3' opacity='0.55'/>",
                "<path d='M120 52c12 20 26 30 26 50a26 26 0 1 1-52 0c0-20 14-30 26-50z' fill='",
                color,
                "'/>",
                "<circle cx='120' cy='108' r='9' fill='#0b1020'/>"
            )
        );
        return
            string(
                abi.encodePacked(
                    head,
                    "<text x='120' y='192' font-family='monospace' font-size='19' fill='#e5e7eb' text-anchor='middle'>",
                    tierName(tier),
                    "</text>",
                    "<text x='120' y='216' font-family='monospace' font-size='12' fill='#94a3b8' text-anchor='middle'>",
                    _toString(tierRequirement(tier)),
                    "-day streak</text></svg>"
                )
            );
    }

    function _badgeImageURI(uint8 tier) internal pure returns (string memory) {
        return string(abi.encodePacked("data:image/svg+xml;base64,", _b64(bytes(_badgeSVG(tier)))));
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_badgeOwner[tokenId] != address(0), "AgentBeacon: nonexistent badge");
        uint8 tier = _badgeTier[tokenId];
        string memory req = _toString(tierRequirement(tier));
        string memory json = string(
            abi.encodePacked(
                '{"name":"Agent Beacon Badge - ',
                tierName(tier),
                '","description":"Soulbound milestone badge from Agent Beacon, the daily check-in ritual for Agent ID holders. Awarded for a ',
                req,
                '-day check-in streak. Badges are collectibles with no monetary value.","image":"',
                _badgeImageURI(tier),
                '","attributes":[{"trait_type":"Tier","value":"',
                tierName(tier),
                '"},{"trait_type":"Streak days required","value":',
                req,
                "}]}"
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", _b64(bytes(json))));
    }

    // ------------------------- Small helpers ---------------------------

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _b64(bytes memory data) internal pure returns (string memory) {
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory result = new bytes(4 * ((len + 2) / 3));
        uint256 j = 0;
        uint256 i = 0;
        for (; i + 3 <= len; i += 3) {
            uint256 triple = (uint256(uint8(data[i])) << 16) |
                (uint256(uint8(data[i + 1])) << 8) |
                uint256(uint8(data[i + 2]));
            result[j++] = table[(triple >> 18) & 63];
            result[j++] = table[(triple >> 12) & 63];
            result[j++] = table[(triple >> 6) & 63];
            result[j++] = table[triple & 63];
        }
        if (len - i == 1) {
            uint256 triple = uint256(uint8(data[i])) << 16;
            result[j++] = table[(triple >> 18) & 63];
            result[j++] = table[(triple >> 12) & 63];
            result[j++] = bytes1("=");
            result[j++] = bytes1("=");
        } else if (len - i == 2) {
            uint256 triple = (uint256(uint8(data[i])) << 16) | (uint256(uint8(data[i + 1])) << 8);
            result[j++] = table[(triple >> 18) & 63];
            result[j++] = table[(triple >> 12) & 63];
            result[j++] = table[(triple >> 6) & 63];
            result[j++] = bytes1("=");
        }
        return string(result);
    }
}
