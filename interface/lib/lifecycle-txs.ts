// Reader for cached on-chain lifecycle event tx hashes. Reads from `lifecycle_txs` only —
// the actual RPC indexing lives in `lifecycle-index.ts` and runs from `upsertReport()` so
// page loads never have to scan logs.
//
// Coverage (mirrors what the indexer populates):
//   L1 governance (Ethereum):  votingActivated, queued, executed, cancelled
//   L2 voting chain:           votingBridged, storageRootsSubmitted, voteStarted, resultsSent
//   Per execution chain:       payloadQueued, payloadExecuted (keyed by `${chainId}-${payloadId}`)

import type { Hex } from 'viem';
import { findVotingChainByPortal, type VotingChainConfig } from '@robot/core/chains';
import { readLifecycleRows } from './lifecycle-index';

export type TxRef = { txHash: Hex; blockNumber: string };

export type LifecycleTxs = {
  // L1 governance
  votingActivated?: TxRef;
  queued?: TxRef;
  executed?: TxRef;
  cancelled?: TxRef;
  // L2 voting chain
  votingBridged?: TxRef;
  storageRootsSubmitted?: TxRef;
  voteStarted?: TxRef;
  resultsSent?: TxRef;
  /** chainId for the voting events above — needed by the UI to pick the right explorer. */
  votingChainId?: number;
  // Per execution chain (keyed by `${chainId}-${payloadId}`)
  payloadQueued: Record<string, TxRef>;
  payloadExecuted: Record<string, TxRef>;
};

const ZERO_ADDR = '0x' + '00'.repeat(20);

const toRef = (txHash: string, blockNumber: bigint): TxRef => ({
  txHash: txHash as Hex,
  blockNumber: blockNumber.toString(),
});

/**
 * Read cached lifecycle txs for a proposal and assemble the shape the UI expects.
 * The `votingPortal` is used purely to fall back to a chainId if the cache is empty for the
 * voting events but the portal is configured (so the UI can still pick the right explorer
 * once those rows arrive).
 */
export const loadLifecycleTxs = async (
  proposalId: bigint,
  votingPortal: string | null,
): Promise<LifecycleTxs> => {
  const rows = await readLifecycleRows(proposalId);

  const out: LifecycleTxs = { payloadQueued: {}, payloadExecuted: {} };

  let votingChainFromCache: number | undefined;

  for (const r of rows) {
    const ref = toRef(r.txHash, r.blockNumber);
    switch (r.kind) {
      case 'votingActivated':
        out.votingActivated = ref;
        break;
      case 'queued':
        out.queued = ref;
        break;
      case 'executed':
        out.executed = ref;
        break;
      case 'cancelled':
        out.cancelled = ref;
        break;
      case 'votingBridged':
        out.votingBridged = ref;
        votingChainFromCache = r.chainId;
        break;
      case 'storageRootsSubmitted':
        out.storageRootsSubmitted = ref;
        votingChainFromCache = r.chainId;
        break;
      case 'voteStarted':
        out.voteStarted = ref;
        votingChainFromCache = r.chainId;
        break;
      case 'resultsSent':
        out.resultsSent = ref;
        votingChainFromCache = r.chainId;
        break;
      case 'payloadQueued':
        out.payloadQueued[`${r.chainId}-${r.payloadId}`] = ref;
        break;
      case 'payloadExecuted':
        out.payloadExecuted[`${r.chainId}-${r.payloadId}`] = ref;
        break;
      default:
        break;
    }
  }

  if (votingChainFromCache !== undefined) {
    out.votingChainId = votingChainFromCache;
  } else if (votingPortal && votingPortal !== ZERO_ADDR) {
    const cfg: VotingChainConfig | undefined = findVotingChainByPortal(votingPortal as `0x${string}`);
    if (cfg) out.votingChainId = cfg.chainId;
  }

  return out;
};
