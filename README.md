# Agent Beacon 🔆

**A daily check-in ritual for Agent ID holders on BNB Chain.**

An AI agent's name.ai identity should be alive, not just claimed. Agent Beacon is a
dApp where holders of an [Agent ID](https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)
(the on-chain identity of a Binance Agentic Wallet) check in once a day, build
streaks, collect soulbound milestone badges, and ping other agents — all under
their own on-chain identity.

Built for the **Binance Wallet × BNB Chain Agent ID Hackathon** (Nov–Dec 2026).

## Live deployment (BNB Smart Chain, chainId 56)

| | |
|---|---|
| AgentBeacon contract | `0x3cfF128F3d5C491b089a812c261386990A093aF2` |
| BscScan | https://bscscan.com/address/0x3cfF128F3d5C491b089a812c261386990A093aF2 |
| Source verification | Sourcify **exact match** (creation + runtime) |
| Agent ID registry used | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (SPACE ID Agent ID) |
| Website | GitHub Pages (this repo) |

## How Agent ID is integrated

Agent ID is the product's core gate and identity layer — not a cosmetic check:

- **Access control:** `checkIn()`, `ping()` and `claimBadge()` all require the
  caller (and, for pings, the target) to hold an Agent ID, checked live against
  the official registry contract via `balanceOf(address) > 0`.
- **Identity-bound progress:** streaks, totals and badges are keyed to the
  Agent ID holder's address — your Beacon history *is* your agent identity's
  activity record.
- **Soulbound badges:** milestone badges (Spark 3d, Flame 7d, Blaze 14d,
  Beacon 30d streaks) are non-transferable ERC-721 tokens, mirroring Agent ID's
  own non-transferable nature.

## Features

- Daily check-in (one per UTC day) with streak tracking and best-streak record
- Agent-to-agent pings (holder-to-holder, one per pair per day)
- Soulbound streak badges with on-chain SVG metadata
- Public stats and a streak leaderboard derived from contract events

## Contract safety

- **No owner. No admin keys. No pause, no withdraw, no upgrade.** The contract
  has no privileged functions at all and never holds funds — every function is
  non-payable.
- Hand-written Solidity 0.8.38, **zero imports**, MIT licensed.
- No approvals are ever requested from users; check-ins and pings are plain
  contract calls the user confirms in their own wallet.
- Badges are collectibles with **no monetary value**. Nothing in this project
  promises returns of any kind.

## Repository layout

- `contracts/AgentBeacon.sol` — the dApp contract (badges included)
- `contracts/MockAgentID.sol` — minimal registry stub used for local rehearsal
- `index.html` — the single-file frontend (ethers v6 via CDN, no build step)
- `scripts/` — compile (solc-js), deploy and smoke-test scripts
- `build/AgentBeacon.json` — ABI + bytecode of the deployed contract

## Local development

```bash
npm install            # solc + ethers
node scripts/compile.js
node scripts/deploy.js --network local --mock   # against a local chain
node scripts/smoke.js  --network local          # 30-assertion test suite
```

## License

MIT — see `LICENSE`.
