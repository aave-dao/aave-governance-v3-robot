// Scans `VoteEmitted(uint256 proposalId, address voter, bool support, uint256 votingPower)`
// logs on the voting machine for a given proposal, inserts new rows into the `votes` table,
// and advances `proposals.votes_synced_to_block`.
//
// Strategy
//   - Look up the voting-machine `getProposalById` to find `creationBlockNumber` (start) and
//     `votingClosedAndSentBlockNumber` (hard stop, 0 if voting is still in progress).
//   - Scan from max(stored cursor + 1, creationBlockNumber) to min(stop, latestBlock,
//     cursor + MAX_BLOCKS_PER_RUN). MAX_BLOCKS_PER_RUN bounds the work per cron tick so a
//     freshly-encountered active proposal doesn't blow the request budget.
//   - Within that window, fetch logs in CHUNK_SIZE-block windows. Insert with ON CONFLICT
//     DO NOTHING — the unique key (proposalId, votingChainId, txHash, logIndex) makes the
//     scan idempotent across overlapping runs and re-orgs.
//
// `MAX_BLOCKS_PER_RUN` is null in the backfill path (caller passes `unbounded: true`) so
// historical proposals get fully synced in one shot.

import { eq } from 'drizzle-orm';
import {
  parseAbiItem,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from 'viem';
import { VOTING_CHAINS, type VotingChainId } from '@robot/core/chains';
import { votingMachineAbi } from '@robot/core/abis';
import type { Logger } from '@robot/core/logger';
import { db } from '@/db/client';
import { proposals, votes } from '@/db/schema';

const VOTE_EMITTED = parseAbiItem(
  'event VoteEmitted(uint256 indexed proposalId, address indexed voter, bool indexed support, uint256 votingPower)',
);

const DEFAULT_CHUNK = 5_000n;
const DEFAULT_MAX_PER_RUN = 200_000n;

export type VotesSyncSummary = {
  proposalId: string;
  votingChainId: number;
  fromBlock: string;
  toBlock: string;
  inserted: number;
};

type Args = {
  proposalId: bigint;
  votingChainId: number;
  vmClient: PublicClient;
  logger: Logger;
  /** If true, scan from start to finish without the per-run block cap. Used by backfill. */
  unbounded?: boolean;
  /** Per-getLogs window. Defaults to 5_000 — under most public RPC limits. */
  chunkSize?: bigint;
};

const requireVoting = (chainId: number) => {
  const cfg = VOTING_CHAINS[chainId as VotingChainId];
  if (!cfg) throw new Error(`chainId ${chainId} is not a configured voting chain`);
  return cfg;
};

type DecodedLog = Log<bigint, number, false, typeof VOTE_EMITTED, true> & {
  args: { proposalId: bigint; voter: Address; support: boolean; votingPower: bigint };
};

export const syncVotesForProposal = async (args: Args): Promise<VotesSyncSummary> => {
  const config = requireVoting(args.votingChainId);
  const chunk = args.chunkSize ?? DEFAULT_CHUNK;

  // Read voting-machine proposal to know the blocks of interest.
  const vmProposal = await args.vmClient.readContract({
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'getProposalById',
    args: [args.proposalId],
  });
  const startBlock = vmProposal.creationBlockNumber;
  const closeBlock = vmProposal.votingClosedAndSentBlockNumber; // 0 while still active
  if (startBlock === 0n) {
    return {
      proposalId: args.proposalId.toString(),
      votingChainId: args.votingChainId,
      fromBlock: '0',
      toBlock: '0',
      inserted: 0,
    };
  }

  const [existing] = await db
    .select({ syncedTo: proposals.votesSyncedToBlock })
    .from(proposals)
    .where(eq(proposals.id, args.proposalId));
  const cursor = existing?.syncedTo ?? null;

  const fromBlock = cursor !== null && cursor > startBlock ? cursor + 1n : startBlock;
  const latest = await args.vmClient.getBlockNumber();
  const hardStop = closeBlock > 0n ? closeBlock : latest;
  let toBlock = hardStop;
  if (!args.unbounded && toBlock - fromBlock + 1n > DEFAULT_MAX_PER_RUN) {
    toBlock = fromBlock + DEFAULT_MAX_PER_RUN - 1n;
  }
  if (fromBlock > toBlock) {
    return {
      proposalId: args.proposalId.toString(),
      votingChainId: args.votingChainId,
      fromBlock: fromBlock.toString(),
      toBlock: fromBlock.toString(),
      inserted: 0,
    };
  }

  args.logger.debug('votes-sync: scanning', {
    proposalId: args.proposalId.toString(),
    chain: config.name,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
  });

  let inserted = 0;
  for (let cur = fromBlock; cur <= toBlock; cur += chunk) {
    const end = cur + chunk - 1n > toBlock ? toBlock : cur + chunk - 1n;
    const logs = (await args.vmClient.getLogs({
      address: config.votingMachine,
      event: VOTE_EMITTED,
      args: { proposalId: args.proposalId },
      fromBlock: cur,
      toBlock: end,
      strict: true,
    })) as DecodedLog[];

    if (logs.length > 0) {
      const rows = logs.map((log) => ({
        proposalId: args.proposalId,
        votingChainId: args.votingChainId,
        voter: log.args.voter as string,
        support: log.args.support,
        votingPower: log.args.votingPower.toString(),
        txHash: log.transactionHash as Hex,
        blockNumber: log.blockNumber!,
        logIndex: log.logIndex!,
      }));
      const result = await db.insert(votes).values(rows).onConflictDoNothing();
      // postgres-js returns rowCount on the result; drizzle types vary by driver, but we just
      // need a best-effort count for telemetry.
      const rc = (result as unknown as { rowCount?: number }).rowCount;
      inserted += typeof rc === 'number' ? rc : rows.length;
    }
  }

  await db
    .update(proposals)
    .set({ votesSyncedToBlock: toBlock })
    .where(eq(proposals.id, args.proposalId));

  return {
    proposalId: args.proposalId.toString(),
    votingChainId: args.votingChainId,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    inserted,
  };
};
