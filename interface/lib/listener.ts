import 'server-only';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import { eq } from 'drizzle-orm';
import {
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';
import { governanceAbi } from '@robot/core/abis';
import { executeSubmitStorageRoots } from '@robot/core/actions';
import { GOVERNANCE_CHAIN_ID, findVotingChainByPortal } from '@robot/core/chains';
import { db } from '@/db/client';
import { cursors } from '@/db/schema';
import {
  ethRpcUrlFromEnv,
  makeReadContextFromEnv,
  makeWriteContextFromEnv,
} from './context-factory';
import { getLogger } from './logger';

const VOTING_ACTIVATED = parseAbiItem(
  'event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
);

const MAX_BLOCK_RANGE = 5_000n;
const CURSOR_NAME = 'voting_activated_l1';

type Outcome =
  | { proposalId: string; status: 'submitted'; txHash: string; chain: string }
  | { proposalId: string; status: 'skipped'; reason: string; chain: string }
  | { proposalId: string; status: 'failed'; error: string; chain?: string }
  | { proposalId: string; status: 'no-voting-chain'; portal: string };

export const runListenerPoll = async () => {
  const logger = getLogger();
  const govCtx = makeReadContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');

  const [cursor] = await db.select().from(cursors).where(eq(cursors.name, CURSOR_NAME));
  if (!cursor) {
    throw new Error(
      `listener cursor '${CURSOR_NAME}' not initialized — run \`bun run db:seed\` once`,
    );
  }

  const latest = await govCtx.publicClient.getBlockNumber();
  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > latest) {
    return { processed: 0, fromBlock: fromBlock.toString(), toBlock: latest.toString() };
  }
  const toBlock =
    latest - fromBlock + 1n > MAX_BLOCK_RANGE ? fromBlock + MAX_BLOCK_RANGE - 1n : latest;

  const logs = await govCtx.publicClient.getLogs({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    event: VOTING_ACTIVATED,
    fromBlock,
    toBlock,
  });
  logger.info('listener: logs fetched', {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    count: logs.length,
  });

  const outcomes: Outcome[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: governanceAbi,
        eventName: 'VotingActivated',
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as {
        proposalId: bigint;
        snapshotBlockHash: Hex;
        votingDuration: number;
      };
      const proposalId = args.proposalId;
      const proposal = await govCtx.publicClient.readContract({
        address: GovernanceV3Ethereum.GOVERNANCE as Address,
        abi: governanceAbi,
        functionName: 'getProposal',
        args: [proposalId],
      });
      const portal = proposal.votingPortal as Address;
      const votingChain = findVotingChainByPortal(portal);
      if (!votingChain) {
        outcomes.push({
          proposalId: proposalId.toString(),
          status: 'no-voting-chain',
          portal,
        });
        continue;
      }

      const ctx = makeWriteContextFromEnv(votingChain.chainId, votingChain.name);
      const result = await executeSubmitStorageRoots(
        { ...ctx, ethRpcUrl: ethRpcUrlFromEnv() },
        { proposalId, l1ProposalBlockHash: args.snapshotBlockHash },
      );
      if (result.txHash) {
        outcomes.push({
          proposalId: proposalId.toString(),
          status: 'submitted',
          txHash: result.txHash,
          chain: votingChain.name,
        });
      } else {
        outcomes.push({
          proposalId: proposalId.toString(),
          status: 'skipped',
          reason: result.skipped,
          chain: votingChain.name,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('listener: log handling failed', { error: message });
      outcomes.push({
        proposalId: 'unknown',
        status: 'failed',
        error: message,
      });
    }
  }

  await db
    .update(cursors)
    .set({ lastBlock: toBlock, updatedAt: new Date() })
    .where(eq(cursors.name, CURSOR_NAME));

  return {
    processed: outcomes.length,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    outcomes,
  };
};
