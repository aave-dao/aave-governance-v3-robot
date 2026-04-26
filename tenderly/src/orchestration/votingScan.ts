import { votingMachineAbi } from '../core/abis';
import { VOTING_CHAINS, type VotingChainId } from '../core/chains';
import {
  closeAndSendVoteAction,
  createVoteAction,
  executeSubmitStorageRoots,
  hasRequiredRoots,
} from '../core/actions';
import type { ReadContext, WriteContext } from '../core/context';
import { VotingMachineProposalState, votingProposalStateName } from '../core/state';

/**
 * Mirrors VotingChainRobotKeeper paginated scan:
 *   - Fetch SIZE proposalIds at offset
 *   - Decide an action per id (submit-roots > createVote > closeAndSend)
 *   - Continue paging if any actions were found in the last batch
 */
export const VOTING_SCAN_PAGE_SIZE = 20n;

type VotingActionKind = 'submitStorageRoots' | 'createVote' | 'closeAndSendVote';

export type VotingScannedAction =
  | { kind: 'submitStorageRoots'; proposalId: bigint; l1ProposalBlockHash: `0x${string}` }
  | { kind: 'createVote'; proposalId: bigint }
  | { kind: 'closeAndSendVote'; proposalId: bigint };

const requireVotingChain = (chainId: number) => {
  const config = VOTING_CHAINS[chainId as VotingChainId];
  if (!config) throw new Error(`chainId ${chainId} is not a voting chain`);
  return config;
};

const decideAction = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<VotingScannedAction | undefined> => {
  const config = requireVotingChain(ctx.chainId);
  const state = await ctx.publicClient.readContract({
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'getProposalState',
    args: [proposalId],
  });

  if (state === VotingMachineProposalState.NotCreated) {
    const voteConfig = await ctx.publicClient.readContract({
      address: config.votingMachine,
      abi: votingMachineAbi,
      functionName: 'getProposalVoteConfiguration',
      args: [proposalId],
    });
    const blockHash = voteConfig.l1ProposalBlockHash as `0x${string}`;
    if (blockHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return undefined;
    }
    const ready = await hasRequiredRoots(ctx, config, blockHash);
    if (!ready) return { kind: 'submitStorageRoots', proposalId, l1ProposalBlockHash: blockHash };
    return { kind: 'createVote', proposalId };
  }

  if (state === VotingMachineProposalState.Finished) {
    return { kind: 'closeAndSendVote', proposalId };
  }

  ctx.logger.debug('voting scan: no-op', {
    proposalId: proposalId.toString(),
    state: votingProposalStateName(state),
  });
  return undefined;
};

export const scanVotingChain = async (ctx: ReadContext): Promise<VotingScannedAction[]> => {
  const config = requireVotingChain(ctx.chainId);
  const collected: VotingScannedAction[] = [];
  let skip = 0n;

  while (true) {
    const ids = await ctx.publicClient.readContract({
      address: config.votingMachine,
      abi: votingMachineAbi,
      functionName: 'getProposalsVoteConfigurationIds',
      args: [skip, VOTING_SCAN_PAGE_SIZE],
    });
    if (ids.length === 0) break;

    let foundInBatch = 0;
    for (const id of ids) {
      const decision = await decideAction(ctx, id);
      if (decision) {
        collected.push(decision);
        foundInBatch += 1;
      }
    }

    if (foundInBatch === 0) break;
    skip += VOTING_SCAN_PAGE_SIZE;
  }

  return collected;
};

export const runVotingScan = async (
  ctx: WriteContext & { ethRpcUrl: string },
): Promise<Array<{ kind: VotingActionKind; proposalId: bigint; txHash?: string; error?: string }>> => {
  const items = await scanVotingChain(ctx);
  const results: Array<{ kind: VotingActionKind; proposalId: bigint; txHash?: string; error?: string }> = [];

  for (const item of items) {
    try {
      if (item.kind === 'submitStorageRoots') {
        const { txHash } = await executeSubmitStorageRoots(ctx, {
          proposalId: item.proposalId,
          l1ProposalBlockHash: item.l1ProposalBlockHash,
        });
        results.push({ kind: item.kind, proposalId: item.proposalId, txHash });
      } else if (item.kind === 'createVote') {
        const recheck = await createVoteAction.check(ctx, item.proposalId);
        if (!recheck.ok) {
          results.push({ kind: item.kind, proposalId: item.proposalId, error: recheck.reason });
          continue;
        }
        const { txHash } = await createVoteAction.execute(ctx, item.proposalId);
        results.push({ kind: item.kind, proposalId: item.proposalId, txHash });
      } else {
        const recheck = await closeAndSendVoteAction.check(ctx, item.proposalId);
        if (!recheck.ok) {
          results.push({ kind: item.kind, proposalId: item.proposalId, error: recheck.reason });
          continue;
        }
        const { txHash } = await closeAndSendVoteAction.execute(ctx, item.proposalId);
        results.push({ kind: item.kind, proposalId: item.proposalId, txHash });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error('votingScan: action failed', {
        proposalId: item.proposalId.toString(),
        kind: item.kind,
        error: msg,
      });
      results.push({ kind: item.kind, proposalId: item.proposalId, error: msg });
    }
  }

  return results;
};
