---
name: chainlink-keeper-to-tenderly
description: "Replicate an on-chain Chainlink Automation keeper (KeeperCompatibleInterface) as a Tenderly Action + interface cron in this repo. Trigger when the user shares a keeper contract address (any chain) and asks to mirror it. Use the user's words: 'replicate this keeper', 'turn this keeper into a tenderly action', 'add a robot for X keeper', 'port this chainlink upkeep'."
argument-hint: "[keeper address] [chain name (optional, default mainnet)]"
allowed-tools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Agent"]
---

# Chainlink-keeper → Tenderly Action

Goal: take a deployed Chainlink Automation keeper, understand what it does, and add an
equivalent **action module + orchestration scan + Tenderly action wrapper + interface cron**
to this repo. The on-chain keeper becomes redundant — kept as a fallback while the off-chain
pipeline runs.

## Inputs the user gives you

- **Keeper address** (required) — the contract registered as `target` in Chainlink Automation.
- **Chain** (default: mainnet) — chain the keeper lives on.
- **Optional `checkData`** — if Chainlink Automation registered the keeper with non-empty
  `checkData`, the user might paste it. If they don't, decode it from the upkeep on
  `automation.chain.link` (or from the `KeeperRegistry.getUpkeep` view) — many keepers are
  parameterized this way.

If any of these are missing, ask. Don't guess.

## Workflow

Follow these phases in order. Each phase produces concrete artifacts before the next starts.

### 1 — Clone the keeper source

Persist the source so future readers (and audits) can see the contract this action replaces.

```bash
mkdir -p reference/contracts
cd reference/contracts
# Use the unified ETHERSCAN_API_KEY_<CHAIN> if the per-chain one isn't set —
# Etherscan multichain accepts the same key across all explorers.
# --no-git: skip the forge-std submodule install. We're cloning for reference reading,
# not opening a project in the cloned dir, so don't pollute the repo with a nested git
# tree or submodule pointer. (`--no-commit` does NOT exist; `--commit` is opt-in.)
ETHERSCAN_API_KEY_<CHAIN_UPPER>="${ETHERSCAN_API_KEY_<CHAIN_UPPER>:-$ETHERSCAN_API_KEY_MAINNET}" \
  forge clone --no-git --chain <chain> <ADDRESS> <slug-name>
```

Common chain slugs: `mainnet`, `polygon`, `avalanche`, `arbitrum`, `optimism`, `base`, `bnb`.
If `forge clone` errors with "Free API access is not supported for this chain" at the
*creation-info* step, that's only the bonus block-number lookup — **the source is already
written**. The contract files under `<slug-name>/src/` are what matter.

### 2 — Read the keeper

Open `<slug-name>/src/contracts/*.sol` (the keeper itself) and the interface(s) it imports.

Every Chainlink keeper has the same interface:
```solidity
function checkUpkeep(bytes calldata checkData) external view returns (bool, bytes memory);
function performUpkeep(bytes calldata performData) external;
```

You're looking for three things:

1. **What does `checkUpkeep` actually read?**
   - Most simple keepers decode `checkData` (often a single address or struct) and call a few
     `view` functions on a downstream contract. Note the function names and return shapes —
     these become the action's `check()` body.
   - Some keepers walk an array (e.g. PayloadsController scan): note the loop bounds, skip
     budget, max-actions cap. These become orchestration constants.

2. **What does `performUpkeep` actually write?**
   - Usually one external call to the same downstream contract (`executeEmergencyAction`,
     `executePayload`, `cancelProposal`, etc.). That's the action's `execute()` write.

3. **Are there any state variables the keeper itself owns?**
   - Idempotency guards (cooldowns, last-run timestamps), counters, etc. If yes, you'll need
     a corresponding `view` on the downstream — a Tenderly Action runs stateless and the
     idempotency must come from the contract it calls. (For PoR this is
     `isEmergencyActionPossible()`; the keeper would otherwise loop infinitely.)

Write a 3-5 line summary in your reply: *"Keeper reads X, calls Y if Z"*. Confirm with the
user before scaffolding.

### 3 — Decide the `Id` type

This repo's `ActionModule<Id>` uses one of:
- `bigint` — for proposal/payload IDs (governance, execution).
- `Address` — for entity-keyed actions like PoR (the executor address is the id).
- `void` — for keepers that take no parameters; pass `undefined` and use `ActionModule<void>`.

Pick the smallest fit. The id is what the orchestration scan iterates over.

### 4 — Find addresses in @aave-dao/aave-address-book first

Always check the address book before hardcoding. Greps from this repo:

```bash
grep -rn "PROOF_OF_RESERVE\|YOUR_CONSTANT" \
  interface/node_modules/@aave-dao/aave-address-book/dist \
  --include="*.d.ts" 2>/dev/null | head
```

If the constant exists, import it and tie the chain config to `<Pool>.<CONSTANT>` — never
copy a hex literal into `chains.ts`. We've previously been bitten by drift on hardcoded
addresses (see executionAction.ts comment on MegaETH chain id) — the address book is
authoritative.

If it's not in the address book, ask the user whether to:
- Open a PR upstream to add it (preferred, especially for Aave-owned contracts), or
- Hardcode it in `core/chains.ts` as a temporary literal with a TODO referencing the
  upstream issue.

### 5 — Files to create / edit

Mirror the **PoR action** shape (it's the cleanest single-call example in the repo). Every
new keeper-replica needs the same set of files in **both** `tenderly/` and `interface/`:

| Layer            | tenderly/ path                                      | interface/ mirror                                          |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| ABI              | `tenderly/src/core/abis/<name>.ts`                  | `interface/lib/robot/core/abis/<name>.ts`                  |
| ABI re-export    | `tenderly/src/core/abis/index.ts`                   | `interface/lib/robot/core/abis/index.ts`                   |
| Chain config     | `tenderly/src/core/chains.ts`                       | `interface/lib/robot/core/chains.ts`                       |
| Action module    | `tenderly/src/core/actions/<name>.ts`               | `interface/lib/robot/core/actions/<name>.ts`               |
| Action re-export | `tenderly/src/core/actions/index.ts`                | `interface/lib/robot/core/actions/index.ts`                |
| Orchestration    | `tenderly/src/orchestration/<name>Scan.ts`          | `interface/lib/robot/orchestration/<name>Scan.ts`          |
| Tenderly wrapper | `tenderly/src/tenderly/<name>Action.ts`             | _N/A — interface uses cron route_                          |
| Tenderly export  | `tenderly/src/tenderly/index.ts`                    | _N/A_                                                      |
| CLI commands     | `tenderly/src/cli/index.ts` — single + `run-<name>` | _N/A — interface UI exposes triggers separately_           |
| Interface cron   | _N/A_                                               | `interface/app/api/cron/<slug>/<chain>/route.ts`           |

**Skip the mirror only if the user explicitly said "tenderly only" or "interface only".**
Default is both halves — they're a redundancy pair.

### 6 — Action module template

Open `tenderly/src/core/actions/proofOfReserves.ts` and copy its shape. The contract is:
- `check(ctx, id) → CheckResult` mirrors `checkUpkeep` — read one or more `view` functions
  via a `multicall` (use `MULTICALL3_ADDRESS` from `../abis`), return `{ok: true}` or
  `{ok: false, reason: "..."}`.
- `execute(ctx, id) → {txHash}` calls `check()` first as a precheck, then sends the write
  via `ctx.walletClient.writeContract` and notifies via `notifyTxSuccess` (which in this
  repo waits for the receipt before posting — pass `publicClient: ctx.publicClient`).
- `<name>Action: ActionModule<Id>` with `name`, `check`, `execute`.

### 7 — Orchestration scan

Mirror `tenderly/src/orchestration/proofOfReservesScan.ts`:
- `scan<name>(ctx)` returns the list of ids that are `ok` from `check()`.
- `run<name>Scan(ctx)` calls `execute` on each. Re-check before write to dodge races.

If the keeper iterates an enumerable downstream (like PayloadsController.getPayloadsCount),
borrow the windowing pattern from `tenderly/src/orchestration/executionScan.ts`
(`MAX_*_SKIP`, `MAX_*_ACTIONS`, single multicall fetch, walk-and-skip loop).

### 8 — Tenderly action wrapper

Mirror `tenderly/src/tenderly/proofOfReservesAction.ts` — a `makeXxxAction(chainId)` factory
plus per-chain exports. Wrap with `setupChain` + try/catch that calls `notifyError` and
re-throws (preserves Tenderly's failure recording). Add to `tenderly/src/tenderly/index.ts`
exports.

### 9 — Tenderly registration

In `tenderly/tenderly.yaml`, add an entry under `specs:`:

```yaml
<slug>-<chain>:
  description: "<one-line description of what this replaces>"
  function: tenderly/index:<exportedActionFn>
  trigger: { type: periodic, periodic: { interval: 5m } }
```

If the keeper is event-driven (rare for upkeeps but possible — see
`voting-activated-listener` in tenderly.yaml for the shape), use a
`type: transaction` trigger with the right contract address + event name instead.

### 9b — CLI parity

Every action in this repo has manual-trigger CLI commands alongside the Tenderly/cron
runners — operators rely on them for ad-hoc executions and incident response. Add **two**
to `tenderly/src/cli/index.ts`:

- A single-id command (e.g. `proof-of-reserves <executor>`) that calls
  `<name>Action.execute(ctx, id)` directly.
- A bulk `run-<name>` scan command, optionally `--chain`-filtered, that calls
  `run<Name>Scan(ctx)` for each chain.

Pattern-match the closest existing pair: `proof-of-reserves` + `run-proof-of-reserves` is
the simplest reference; `execute-payload` + `run-execution` shows the chain-resolver
variant; `submit-roots` + `run-voting` shows the proposal-id-resolves-chain variant.

If the action's id needs disambiguation (e.g. address-or-label), add a tiny resolver helper
next to the existing `resolveExecutionChainByName` / `resolveVotingChainByName` — keep it
file-local, not exported.

### 10 — Interface cron

Mirror `interface/app/api/cron/proof-of-reserves/avalanche/route.ts`:

```ts
import { <Pool> } from '@aave-dao/aave-address-book';
import { run<Name>Scan } from '@robot/orchestration/<name>Scan';
import { makeWriteContextFromEnv } from '@/lib/context-factory';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = wrapCron('<slug>-<chain>', async () => {
  const ctx = makeWriteContextFromEnv(<CHAIN_ID>, '<chain>');
  const results = await run<Name>Scan(ctx);
  return { chainId: <CHAIN_ID>, chainName: '<chain>', results };
});
```

Then add the cron registration to `interface/vercel.json`:

```json
{ "path": "/api/cron/<slug>/<chain>", "schedule": "*/5 * * * *" }
```

Match the schedule between `tenderly.yaml` and `vercel.json`. Most actions in this repo run
`*/5 * * * *` (every 5 min) or `* * * * *` (every minute, for fast-moving scans like
governance/voting/exec). Pick the one that fits the urgency of the action — emergency-style
keepers should be every 5 min at minimum.

### 11 — Tests

Mirror `tenderly/tests/actions.proofOfReserves.test.ts`:
- `check` returns `ok` for the trigger condition.
- `check` returns each of the negative branches with the right `reason`.
- `execute` writes the right `functionName` to the right address with the right args.
- Unregistered ids are rejected.

Use `makeMockClient`, `makeMockWalletClient`, `makeWalletSpy`, `silentLogger` from
`tests/helpers/mockClient.ts`. The mock client already returns a synthetic `success`
receipt from `waitForTransactionReceipt` so `notifyTxSuccess`'s confirmation wait
short-circuits cleanly in tests.

### 12 — Verify

```bash
cd tenderly && bun run typecheck && bun test
cd ../interface && bun run typecheck
```

Both must be clean. If you renamed shared types or added new files, also rebuild the
Tenderly bundle locally to catch esbuild-only failures:

```bash
cd tenderly && bunx @tenderly/actions build  # if installed
```

## Things to check with the user before finalizing

These choices materially affect the implementation — surface them as `AskUserQuestion`
options rather than assuming:

1. **Which executors / ids to monitor** — if the keeper is registered multiple times in
   Chainlink Automation with different `checkData`, list each on `automation.chain.link`
   and confirm whether the action should cover all of them.
2. **Tenderly + interface, or just one** — defaults to both (redundancy pair). User may want
   one-sided rollout.
3. **Schedule** — `*/5` for emergency-style, `* * * * *` for governance-level urgency, `1h`
   for low-frequency drift checks.
4. **Notification tone** — most actions use the standard ✅/🚨 from `notifyTxSuccess` /
   `notifyError`. If this is a real emergency action (PoR, freeze), surface that in the
   Slack/Telegram message body — pass a meta with `severity: 'emergency'` and lead with a
   `logger.warn()` so the audit trail is obvious in logs.

## Reference: a fully-worked example in this repo

The Avalanche Proof-of-Reserves action (commit-grouped on this branch) is the canonical
example of replicating a single-shot Chainlink keeper:

- Keeper source: `reference/contracts/avalanche-proof-of-reserves-keeper/`
- ABI: `tenderly/src/core/abis/proofOfReserveExecutor.ts`
- Chain config: `PROOF_OF_RESERVE_CHAINS` in `tenderly/src/core/chains.ts`
- Action: `tenderly/src/core/actions/proofOfReserves.ts`
- Scan: `tenderly/src/orchestration/proofOfReservesScan.ts`
- Tenderly wrapper: `tenderly/src/tenderly/proofOfReservesAction.ts`
- CLI: `proof-of-reserves` + `run-proof-of-reserves` in `tenderly/src/cli/index.ts`
- Tests: `tenderly/tests/actions.proofOfReserves.test.ts`
- Interface cron: `interface/app/api/cron/proof-of-reserves/avalanche/route.ts`
- Registrations: `tenderly/tenderly.yaml` + `interface/vercel.json`

Read it as a reference whenever you scaffold a new one. Match the file structure and
naming conventions; deviating from them just creates inconsistency for the next reader.
