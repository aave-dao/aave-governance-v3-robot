// Indexer for proposal lifecycle event tx hashes. Runs from `upsertReport()` (and via that
// from cache-refresh + the page's first-visit fallback). Only fetches events that are
// expected to exist by the proposal's current state and aren't already cached, then upserts
// them into `lifecycle_txs`. Once an event is cached it is never re-fetched.
//
// Coverage matches the previous on-page-load fetcher in `lifecycle-txs.ts`:
//   L1 governance (Ethereum):
//     • VotingActivated   (proposalState >= Active)
//     • ProposalQueued    (proposalState >= Queued)
//     • ProposalExecuted  (proposalState == Executed)
//     • ProposalCanceled  (proposalState == Cancelled)
//
//   L2 voting chain (per resolved voting portal):
//     • ProposalVoteConfigurationBridged (vmStateName != null && != NotCreated)
//     • StorageRootProcessed             (vmStateName != null && snapshotBlockHash set)
//     • ProposalVoteStarted              (vmStateName in Active/Finished/SentToGovernance)
//     • ProposalResultsSent              (vmStateName == SentToGovernance)
//
//   Per execution chain:
//     • PayloadQueued    (payload.queuedAt > 0)
//     • PayloadExecuted  (payload.executedAt > 0)
//
// PayloadQueued/Executed are not indexed events, so we scan a narrow ±300-block window
// around the cached timestamp and decode each log to find the matching id.

import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import { eq, inArray } from 'drizzle-orm';
import {
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  EXECUTION_CHAINS,
  GOVERNANCE_CHAIN_ID,
  findVotingChainByPortal,
  type VotingChainConfig,
} from '@robot/core/chains';
import { getPublicClient } from '@robot/core/clients';
import { db } from '@/db/client';
import { lifecycleTxs } from '@/db/schema';
import { getLogger } from './logger';

// ─── Event signatures ─────────────────────────────────────────────────────────

const VotingActivatedEvent = parseAbiItem(
  'event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
);
const ProposalQueuedEvent = parseAbiItem(
  'event ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
);
const ProposalExecutedEvent = parseAbiItem(
  'event ProposalExecuted(uint256 indexed proposalId)',
);
const ProposalCanceledEvent = parseAbiItem(
  'event ProposalCanceled(uint256 indexed proposalId)',
);
const ProposalVoteConfigurationBridgedEvent = parseAbiItem(
  'event ProposalVoteConfigurationBridged(uint256 indexed proposalId, bytes32 indexed blockHash, uint24 votingDuration, bool indexed voteCreated)',
);
const ProposalVoteStartedEvent = parseAbiItem(
  'event ProposalVoteStarted(uint256 indexed proposalId, bytes32 indexed l1BlockHash, uint256 startTime, uint256 endTime)',
);
const ProposalResultsSentEvent = parseAbiItem(
  'event ProposalResultsSent(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes)',
);
const StorageRootProcessedEvent = parseAbiItem(
  'event StorageRootProcessed(address indexed caller, address indexed account, bytes32 indexed blockHash)',
);
const PayloadQueuedEvent = parseAbiItem('event PayloadQueued(uint40 payloadId)');
const PayloadExecutedEvent = parseAbiItem('event PayloadExecuted(uint40 payloadId)');

const ZERO_HASH = ('0x' + '00'.repeat(32)) as Hex;
const ZERO_ADDR = ('0x' + '00'.repeat(20)) as Address;

const SECONDS_PER_BLOCK_L1 = 12;
const L1_LOOKBACK_BUFFER_BLOCKS = 5_000n;
const VOTING_LOOKBACK_BUFFER_BLOCKS = 5_000n;
const PAYLOAD_WINDOW_BLOCKS = 600n;

// Conservative seconds-per-block estimates per chain — bias smaller so the resulting block
// window is wider rather than risk missing the event.
const SECONDS_PER_BLOCK: Record<number, number> = {
  1: 12,
  10: 2,
  56: 3,
  100: 5,
  137: 2,
  146: 1,
  196: 3,
  324: 1,
  1088: 4,
  1868: 2,
  4326: 1,
  5000: 1,
  8453: 2,
  9745: 1,
  42161: 1,
  42220: 5,
  43114: 2,
  57073: 1,
  59144: 2,
  534352: 3,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export type IndexPayload = {
  chainId: number;
  payloadId: number;
  stateNumber: number;
  /** Cached unix-seconds for the queued tx — used to narrow the log scan window. */
  queuedAt: number | null;
  /** Cached unix-seconds for the executed tx — used to narrow the log scan window. */
  executedAt: number | null;
};

export type IndexInput = {
  proposalId: bigint;
  proposalState: number;
  vmStateName: string | null;
  creationTime: number;
  votingPortal: Address | null;
  snapshotBlockHash: Hex | null;
  payloads: IndexPayload[];
};

/** All possible kinds (string-typed in DB for forward-compat). */
type Kind =
  | 'votingActivated'
  | 'queued'
  | 'executed'
  | 'cancelled'
  | 'votingBridged'
  | 'storageRootsSubmitted'
  | 'voteStarted'
  | 'resultsSent'
  | 'payloadQueued'
  | 'payloadExecuted';

type CachedKey = string;
const cacheKey = (kind: Kind, chainId: number, payloadId: number = -1): CachedKey =>
  `${kind}:${chainId}:${payloadId}`;

type Found = {
  kind: Kind;
  chainId: number;
  payloadId: number;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
};

/**
 * For a given proposal, fetch every lifecycle event that *should* exist by now (per the
 * inspector's view of state) and isn't already cached, then upsert into `lifecycle_txs`.
 * Best-effort: never throws — RPC failures are logged and retried next tick.
 */
export const indexLifecycleTxs = async (input: IndexInput): Promise<void> => {
  const cached = await readCachedKeys(input.proposalId);
  const found: Found[] = [];

  await Promise.all([
    indexL1(input, cached, found),
    indexVoting(input, cached, found),
    indexPayloads(input, cached, found),
  ]);

  if (found.length === 0) return;

  const rows = found.map((f) => ({
    proposalId: input.proposalId,
    kind: f.kind,
    chainId: f.chainId,
    payloadId: f.payloadId,
    txHash: f.txHash,
    blockNumber: f.blockNumber,
    logIndex: f.logIndex,
  }));
  try {
    await db.insert(lifecycleTxs).values(rows).onConflictDoNothing();
  } catch (err) {
    getLogger().warn('lifecycle-index: insert failed', {
      proposalId: input.proposalId.toString(),
      count: rows.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const readCachedKeys = async (proposalId: bigint): Promise<Set<CachedKey>> => {
  const rows = await db
    .select({
      kind: lifecycleTxs.kind,
      chainId: lifecycleTxs.chainId,
      payloadId: lifecycleTxs.payloadId,
    })
    .from(lifecycleTxs)
    .where(eq(lifecycleTxs.proposalId, proposalId));
  return new Set(rows.map((r) => cacheKey(r.kind as Kind, r.chainId, r.payloadId)));
};

// ─── L1 governance ────────────────────────────────────────────────────────────

const indexL1 = async (
  input: IndexInput,
  cached: Set<CachedKey>,
  found: Found[],
): Promise<void> => {
  const wants: Kind[] = [];
  if (input.proposalState >= 2 && !cached.has(cacheKey('votingActivated', GOVERNANCE_CHAIN_ID))) {
    wants.push('votingActivated');
  }
  if (input.proposalState >= 3 && !cached.has(cacheKey('queued', GOVERNANCE_CHAIN_ID))) {
    wants.push('queued');
  }
  if (input.proposalState === 4 && !cached.has(cacheKey('executed', GOVERNANCE_CHAIN_ID))) {
    wants.push('executed');
  }
  if (input.proposalState === 6 && !cached.has(cacheKey('cancelled', GOVERNANCE_CHAIN_ID))) {
    wants.push('cancelled');
  }
  if (wants.length === 0) return;

  let client: PublicClient;
  try {
    client = getPublicClient(GOVERNANCE_CHAIN_ID) as PublicClient;
  } catch {
    return;
  }
  const latestBlock = await client.getBlockNumber().catch(() => null);
  if (latestBlock === null) return;

  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - input.creationTime);
  const span = BigInt(Math.floor(elapsed / SECONDS_PER_BLOCK_L1)) + L1_LOOKBACK_BUFFER_BLOCKS;
  const fromBlock = span > latestBlock ? 0n : latestBlock - span;
  const govAddr = GovernanceV3Ethereum.GOVERNANCE as Address;
  const ctx = { source: 'l1', proposalId: input.proposalId.toString() };

  await Promise.all(
    wants.map(async (kind) => {
      const event =
        kind === 'votingActivated'
          ? VotingActivatedEvent
          : kind === 'queued'
            ? ProposalQueuedEvent
            : kind === 'executed'
              ? ProposalExecutedEvent
              : ProposalCanceledEvent;
      try {
        const logs = await client.getLogs({
          address: govAddr,
          event,
          args: { proposalId: input.proposalId },
          fromBlock,
          toBlock: latestBlock,
        });
        const log = logs[0];
        if (log) {
          found.push({
            kind,
            chainId: GOVERNANCE_CHAIN_ID,
            payloadId: -1,
            txHash: log.transactionHash as Hex,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex!,
          });
        }
      } catch (err) {
        getLogger().warn('lifecycle-index: getLogs failed', {
          ...ctx,
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
};

// ─── L2 voting chain ──────────────────────────────────────────────────────────

const indexVoting = async (
  input: IndexInput,
  cached: Set<CachedKey>,
  found: Found[],
): Promise<void> => {
  if (!input.votingPortal || input.votingPortal === ZERO_ADDR) return;
  const cfg: VotingChainConfig | undefined = findVotingChainByPortal(input.votingPortal);
  if (!cfg) return;

  // Voting hops only become relevant once a vote has been bridged / created on L2. If the
  // inspector hasn't seen a vm proposal yet (vmStateName null or NotCreated), nothing to fetch.
  const vmActive =
    input.vmStateName !== null &&
    input.vmStateName !== undefined &&
    input.vmStateName !== 'NotCreated';
  if (!vmActive) return;

  const wants: Array<{ kind: Kind; addr: Address }> = [];
  if (!cached.has(cacheKey('votingBridged', cfg.chainId))) {
    wants.push({ kind: 'votingBridged', addr: cfg.votingMachine });
  }
  if (
    !cached.has(cacheKey('voteStarted', cfg.chainId)) &&
    (input.vmStateName === 'Active' ||
      input.vmStateName === 'Finished' ||
      input.vmStateName === 'SentToGovernance')
  ) {
    wants.push({ kind: 'voteStarted', addr: cfg.votingMachine });
  }
  if (
    !cached.has(cacheKey('resultsSent', cfg.chainId)) &&
    input.vmStateName === 'SentToGovernance'
  ) {
    wants.push({ kind: 'resultsSent', addr: cfg.votingMachine });
  }
  const wantRoots =
    !!input.snapshotBlockHash &&
    input.snapshotBlockHash !== ZERO_HASH &&
    !cached.has(cacheKey('storageRootsSubmitted', cfg.chainId));

  if (wants.length === 0 && !wantRoots) return;

  let client: PublicClient;
  try {
    client = getPublicClient(cfg.chainId) as PublicClient;
  } catch {
    return;
  }
  const latestBlock = await client.getBlockNumber().catch(() => null);
  if (latestBlock === null) return;

  const blockTimeSec = SECONDS_PER_BLOCK[cfg.chainId] ?? 2;
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - input.creationTime);
  const span = BigInt(Math.floor(elapsed / blockTimeSec)) + VOTING_LOOKBACK_BUFFER_BLOCKS;
  const fromBlock = span > latestBlock ? 0n : latestBlock - span;
  const ctx = {
    source: 'voting',
    chainId: cfg.chainId,
    proposalId: input.proposalId.toString(),
  };

  const tasks: Promise<void>[] = wants.map(async ({ kind, addr }) => {
    const event =
      kind === 'votingBridged'
        ? ProposalVoteConfigurationBridgedEvent
        : kind === 'voteStarted'
          ? ProposalVoteStartedEvent
          : ProposalResultsSentEvent;
    try {
      const logs = await client.getLogs({
        address: addr,
        event,
        args: { proposalId: input.proposalId },
        fromBlock,
        toBlock: latestBlock,
      });
      const log = logs[0];
      if (log) {
        found.push({
          kind,
          chainId: cfg.chainId,
          payloadId: -1,
          txHash: log.transactionHash as Hex,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex!,
        });
      }
    } catch (err) {
      getLogger().warn('lifecycle-index: getLogs failed', {
        ...ctx,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (wantRoots) {
    tasks.push(
      (async () => {
        try {
          const logs = await client.getLogs({
            address: cfg.dataWarehouse,
            event: StorageRootProcessedEvent,
            args: { blockHash: input.snapshotBlockHash! },
            fromBlock,
            toBlock: latestBlock,
          });
          const log = logs[0];
          if (log) {
            found.push({
              kind: 'storageRootsSubmitted',
              chainId: cfg.chainId,
              payloadId: -1,
              txHash: log.transactionHash as Hex,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex!,
            });
          }
        } catch (err) {
          getLogger().warn('lifecycle-index: getLogs failed', {
            ...ctx,
            kind: 'storageRootsSubmitted',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })(),
    );
  }

  await Promise.all(tasks);
};

// ─── Payload events ───────────────────────────────────────────────────────────

const indexPayloads = async (
  input: IndexInput,
  cached: Set<CachedKey>,
  found: Found[],
): Promise<void> => {
  const tasks: Promise<void>[] = [];
  for (const p of input.payloads) {
    if (p.queuedAt && p.queuedAt > 0 && !cached.has(cacheKey('payloadQueued', p.chainId, p.payloadId))) {
      tasks.push(scanPayloadEvent(input.proposalId, p, 'payloadQueued', found));
    }
    if (p.executedAt && p.executedAt > 0 && !cached.has(cacheKey('payloadExecuted', p.chainId, p.payloadId))) {
      tasks.push(scanPayloadEvent(input.proposalId, p, 'payloadExecuted', found));
    }
  }
  await Promise.all(tasks);
};

const scanPayloadEvent = async (
  proposalId: bigint,
  payload: IndexPayload,
  kind: 'payloadQueued' | 'payloadExecuted',
  found: Found[],
): Promise<void> => {
  const ts = kind === 'payloadQueued' ? payload.queuedAt : payload.executedAt;
  if (!ts || ts === 0) return;
  const cfg = EXECUTION_CHAINS[payload.chainId];
  if (!cfg) return;
  let client: PublicClient;
  try {
    client = getPublicClient(payload.chainId) as PublicClient;
  } catch {
    return;
  }

  const blockTimeSec = SECONDS_PER_BLOCK[payload.chainId] ?? 2;
  const latestBlock = await client.getBlockNumber().catch(() => null);
  if (latestBlock === null) return;

  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  const blocksAgo = BigInt(Math.floor(elapsed / blockTimeSec));
  const center = blocksAgo > latestBlock ? 0n : latestBlock - blocksAgo;
  const half = PAYLOAD_WINDOW_BLOCKS / 2n;
  const fromBlock = center > half ? center - half : 0n;
  const toBlock = center + half > latestBlock ? latestBlock : center + half;

  const event = kind === 'payloadQueued' ? PayloadQueuedEvent : PayloadExecutedEvent;
  try {
    const logs = await client.getLogs({
      address: cfg.payloadsController as Address,
      event,
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
      const args = decoded.args as unknown as { payloadId: number };
      if (Number(args.payloadId) === payload.payloadId) {
        found.push({
          kind,
          chainId: payload.chainId,
          payloadId: payload.payloadId,
          txHash: log.transactionHash as Hex,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex!,
        });
        return;
      }
    }
  } catch (err) {
    getLogger().warn('lifecycle-index: payload getLogs failed', {
      proposalId: proposalId.toString(),
      kind,
      chainId: payload.chainId,
      payloadId: payload.payloadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// ─── Backfill helper (for one-shot CLI / admin endpoint use) ──────────────────

/** Drop all cached lifecycle txs for a proposal — used when re-indexing manually. */
export const clearLifecycleTxs = async (proposalIds: bigint[]): Promise<void> => {
  if (proposalIds.length === 0) return;
  await db.delete(lifecycleTxs).where(inArray(lifecycleTxs.proposalId, proposalIds));
};

/** Read raw cached rows for a proposal (used by `lifecycle-txs.ts` reader). */
export const readLifecycleRows = async (proposalId: bigint) => {
  return db
    .select()
    .from(lifecycleTxs)
    .where(eq(lifecycleTxs.proposalId, proposalId));
};
