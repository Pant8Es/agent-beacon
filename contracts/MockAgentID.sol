// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAgentID — testnet/local stand-in for the Agent ID registry.
///
/// @notice Exposes exactly the surface AgentBeacon depends on (ERC-721 style
///         balanceOf) plus a public mint so rehearsals can create holders.
///         NOT for mainnet: on mainnet AgentBeacon is constructed with the
///         real registry at 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F.
contract MockAgentID {
    string public constant name = "Mock Agent ID";
    string public constant symbol = "mAID";

    mapping(address => uint256) private _balances;
    uint256 public totalMinted;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice Public rehearsal mint: anyone can mint an ID to any address.
    function mint(address to) external returns (uint256 tokenId) {
        require(to != address(0), "MockAgentID: zero address");
        tokenId = ++totalMinted;
        _balances[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "MockAgentID: zero address");
        return _balances[owner];
    }
}
