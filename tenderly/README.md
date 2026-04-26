# Aave Governance V3 robot — Tenderly Web3 Actions + CLI

Off-chain replacement for the Chainlink Automation keepers
(`GovernanceChainRobotKeeper`, `VotingChainRobotKeeper`, `ExecutionChainRobotKeeper`)
plus the CRE storage-roots flow. Replicates the keeper logic in TypeScript and runs it as
Tenderly Web3 Actions or via a `bun` CLI.

Every action function on the underlying contracts (`activateVoting`, `executeProposal`,
`cancelProposal`, `startProposalVote`, `closeAndSendVote`, `executePayload`,
`processStorageRoot`, `processStorageSlot`) is permissionless, so this implementation
calls them directly with an EOA — **the on-chain keepers and `RootsConsumer` are not in
the path**.

## Layout

```
src/core/         shared logic — used by both CLI and Tenderly Actions
  abis/            minimal viem ABIs for each contract
  actions/         per-action module: { check(ctx, id), execute(ctx, id) }
  chains.ts        chain → addresses, sourced from @aave-dao/aave-address-book
  clients.ts       viem PublicClient/WalletClient factory
  multicall.ts     Multicall3.aggregate3 wrapper for the storage-roots batch
  proofs.ts        block-header RLP + proof RLP encoders (ported from cre/gov-storage-roots)
  rpc.ts           direct eth_getProof / eth_getBlockByHash JSON-RPC client
  state.ts         ProposalState / PayloadState / VotingMachineProposalState enums

src/orchestration/ scanners and inspector built on top of core/actions
  governanceScan.ts   scan ≤25 latest proposals on the gov chain
  votingScan.ts       paginate getProposalsVoteConfigurationIds
  executionScan.ts    scan ≤25 latest payloads
  proposalInspector.ts walks a single proposal across every stage

src/cli/          commander-based CLI; loads PRIVATE_KEY + RPC URLs from .env
src/tenderly/     Tenderly Web3 Action functions; loads secrets from ctx.secrets
tenderly.yaml     Tenderly Action specs (one periodic per chain + the event listener)
tests/            bun test suite for action predicates and proof encoding
```

## Quick start (CLI)

```bash
bun install
cp .env.example .env
# fill in PRIVATE_KEY and EITHER ALCHEMY_API_KEY (recommended) OR per-chain RPC_<NETWORK>.
# Chain reads use viem PublicClient via @bgd-labs/toolbox getClient, which respects
# ALCHEMY_API_KEY first, then explicit RPC_<NETWORK> overrides (e.g. RPC_MAINNET),
# then the toolbox public-RPC fallback. See src/core/clients.ts.

# inspect a proposal — read-only, prints what's pending and what's blocked,
# enriched with title + author from IPFS metadata
bun run robot inspect 1234

# decode a proposal: title, author, discussions link, payload list, optional full body
bun run robot decode 1234
bun run robot decode 1234 --full     # also prints the IPFS markdown body

# run a single action against the live chains
bun run robot activate 1234
bun run robot submit-roots 1234 --chain polygon
bun run robot create-vote 1234 --chain polygon
bun run robot close-vote 1234 --chain polygon
bun run robot execute 1234
bun run robot execute-payload 56 --chain optimism

# bulk scan-and-execute (mirrors what each Tenderly periodic action does)
bun run robot run-governance
bun run robot run-voting --chain avalanche
bun run robot run-execution --chain ink
```

`inspect` output (ANSI-colored in a terminal, plain when piped or `NO_COLOR=1`):

```
Proposal #476 on ethereum
  Onboard USDe to the Aave V3 MegaETH Instance
  by Aave Labs

  state:         Created
  creator:       0x66a28531E6f390A8CD44aB0C57a0F1aeb7E673FF
  createdAt:     2026-04-25 11:28:35Z (23h22m ago)
  votingPortal:  0x9Ded9406f088C10621BE628EEFf40c1DF396c172
  ipfsHash:      0x0588…159ae

  governance actions:
    ✗ activateVoting: cooldown active (2267s remaining; coolDownBeforeVotingStart=86400s)
    ✗ executeProposal: state=Created, want Queued
    ✗ cancelProposal: creator power … >= min …

  voting (avalanche, chainId 43114):
    state:         NotCreated
    ✗ submitStorageRoots: no snapshot block hash yet (proposal not yet activated on L1)
    ✗ createVote: voteConfig not yet bridged from L1
    ✗ closeAndSendVote: vm state=NotCreated, want Finished

  payloads:
    [megaeth] payload #6 state=Created (1 action)
      ✗ executePayload: state=Created, want Queued

✓ nothing actionable right now
```

When something is ready, the bottom line becomes e.g.:
`→ next: bun run robot submit-roots 1234 --chain polygon`

The title and author come from the proposal's IPFS metadata (parsed YAML frontmatter).
On gateway failure, the inspector falls back to `<title unavailable: …>`. Pass
`--no-metadata` to skip the fetch entirely.

## Tenderly Actions

```bash
# install the Tenderly CLI globally if you don't have it
npm i -g @tenderly/cli

# fill in account_id and project_slug at the top of tenderly.yaml,
# then deploy
tenderly actions deploy

# set secrets via the CLI (or via the Tenderly UI under Web3 Actions → Secrets)
tenderly actions secret set PRIVATE_KEY '0x...'

# Recommended: one Alchemy key covers every supported chain.
tenderly actions secret set ALCHEMY_API_KEY '...'

# Or set explicit per-chain overrides — naming matches @bgd-labs/toolbox getNetworkEnv():
# tenderly actions secret set RPC_MAINNET   'https://...'
# tenderly actions secret set RPC_POLYGON   'https://...'
# tenderly actions secret set RPC_AVALANCHE 'https://...'
# (etc.)
```

`src/tenderly/secrets.ts` copies these from `ctx.secrets` into `process.env` at the top of
each invocation, so `getPublicClient(chainId)` and `getRpcUrl(chainId)` work the same way
in Tenderly as they do in the CLI.

## Notifications (Slack / Telegram)

Out-of-band alerts on every signed tx and every action failure. Best-effort — a failed
channel POST never crashes the action; it logs a warning and moves on.

Configure via env (CLI) or `tenderly actions secret set` (Tenderly):

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Telegram (auto-detect):
#   - if BOT_TOKEN + CHAT_ID are set, the bot API is used (HTML formatting, hyperlinks).
#   - else if TELEGRAM_WEBHOOK_URL is set, we POST {text} to it (opaque relay).
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=-100...
TELEGRAM_WEBHOOK_URL=
```

If none are set, the robot runs silently — nothing posted, no warnings, no errors.

What gets posted:

- **Tx submitted** by the robot (any action across CLI or Tenderly):
  `✅ activateVoting on ethereum — proposal: 1234 — tx: <hyperlink to etherscan>`
- **Tenderly Action failure** (governanceAction, votingActivatedListener, votingAll/per-chain,
  executionAll/per-chain): `🚨 <source> failed (chain: ...) — Error: <message>` with a
  short stack trace. The error is also re-thrown so Tenderly's own dashboard records it.

Channel POSTs use a 5s timeout via `AbortSignal.timeout`. Slack and Telegram are POSTed
in parallel via `Promise.allSettled` — neither blocks the other.

The actions registered in `tenderly.yaml`:

| Spec                        | Trigger                   | Function                                                                                                 |
| --------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `governance-scan`           | every 1m                  | `governanceAction` — scan governance chain, fire activate/execute/cancel                                 |
| `voting-activated-listener` | tx event on L1 governance | `votingActivatedListener` — fetch proofs and submit storage roots to the right voting chain              |
| `voting-scan-{chain}`       | every 2m                  | scan voting chain, fire submitRoots/createVote/closeAndSend (catches anything the event listener missed) |
| `exec-scan-{chain}`         | every 2m                  | scan PayloadsController, fire executePayload                                                             |

## How storage roots work (without RootsConsumer)

The Chainlink path uses an off-chain oracle (`RootsConsumer.requestSubmitRoots` →
oracle → `fulfillRegisterRoots` → 5 calls to DataWarehouse). We skip the entire oracle
hop:

1. The L1 `VotingActivated(proposalId, snapshotBlockHash, _)` event is observed by
   `votingActivatedListener` (or by the next periodic `votingScan`).
2. We fetch the L1 block via `eth_getBlockByHash`, RLP-encode the header
   (`prepareBlockRLP` — supports post-Pectra blocks).
3. We call `eth_getProof` 4 times (AAVE, aAAVE, stkAAVE, Governance) on the snapshot
   block. The stkAAVE call also fetches storage slot `0x51` (exchange rate).
4. We bundle the 5 DataWarehouse calls into a single `Multicall3.aggregate3` tx with
   `allowFailure=true` and submit it on the voting chain.

`allowFailure=true` is intentional: if the Chainlink oracle path lands first, our calls
are no-ops (DataWarehouse just overwrites the same root) and the partial overlap doesn't
abort the batch.

## Running in parallel with Chainlink keepers

This was specifically designed for a deprecation period where both systems run.

| Action                                            | Race outcome                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activateVoting / executeProposal / cancelProposal | second tx reverts on state guard. Wasted gas, no breakage.                                                                                                                         |
| createVote / closeAndSendVote / executePayload    | same — state guard.                                                                                                                                                                |
| storage roots                                     | both submit independently; `processStorageRoot` is idempotent (mapping write of the same root). aggregate3 with allowFailure=true tolerates partial overlap. Wasteful, not broken. |

No state sharing between the two systems is required. Both observe on-chain truth.

## Tests

```bash
bun test
```

Covers every `check()` predicate (state/time/power guards) and the RLP encoders
(post-merge and post-Pectra blocks).

## Tradeoffs / out of scope

- **EIP-7702 batching.** Considered for the storage-roots flow; rejected because
  Multicall3 already gives us atomic batching with no extra deployment.
- **Gas-price cap.** The Chainlink gas-capped variants use a Chainlink fast-gas
  oracle. Easy to add later via `eth_gasPrice` at the top of each Tenderly Action;
  not implemented yet.
- **Disabled-proposal blocklist.** Replicating the keeper's `isDisabled` mapping was
  considered and rejected — emergency mute is achieved by stopping the Tenderly Action.
- **AaveCLRobotOperator migration.** Out of scope; that admin contract becomes obsolete
  once the Chainlink keepers are decommissioned.
