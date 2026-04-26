import { MULTICALL3_ADDRESS, dataWarehouseAbi, votingMachineAbi, votingStrategyAbi } from '../core/abis';
import { VOTING_CHAINS, type VotingChainConfig, type VotingChainId } from '../core/chains';
import {
  closeAndSendVoteAction,
  createVoteAction,
  executeSubmitStorageRoots,
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

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export const scanVotingChain = async (ctx: ReadContext): Promise<VotingScannedAction[]> => {
  const config = requireVotingChain(ctx.chainId);
  ctx.logger.debug('votingScan: starting', { chain: config.name, pageSize: VOTING_SCAN_PAGE_SIZE.toString() });
  const collected: VotingScannedAction[] = [];
  let skip = 0n;

  while (true) {
    const ids = await ctx.publicClient.readContract({
      address: config.votingMachine,
      abi: votingMachineAbi,
      functionName: 'getProposalsVoteConfigurationIds',
      args: [skip, VOTING_SCAN_PAGE_SIZE],
    });
    ctx.logger.trace('votingScan: page fetched', { skip: skip.toString(), count: ids.length });
    if (ids.length === 0) break;

    // Batch every id's (state, voteConfig) read in one multicall — 2N reads → 1 RPC.
    const stateAndConfig = await ctx.publicClient.multicall({
      contracts: ids.flatMap((id) => [
        {
          address: config.votingMachine,
          abi: votingMachineAbi,
          functionName: 'getProposalState' as const,
          args: [id] as const,
        },
        {
          address: config.votingMachine,
          abi: votingMachineAbi,
          functionName: 'getProposalVoteConfiguration' as const,
          args: [id] as const,
        },
      ]),
      allowFailure: false,
      multicallAddress: MULTICALL3_ADDRESS,
    });

    // Build a partial decision per id; resolve "rootsReady" for NotCreated ids in a second batch.
    type Pending = {
      proposalId: bigint;
      state: number;
      blockHash: `0x${string}`;
    };
    const pendingNotCreated: Pending[] = [];
    const decisions = new Map<bigint, VotingScannedAction>();

    ids.forEach((id, i) => {
      const state = stateAndConfig[i * 2] as number;
      const voteConfig = stateAndConfig[i * 2 + 1] as { l1ProposalBlockHash: `0x${string}` };
      const blockHash = voteConfig.l1ProposalBlockHash;

      if (state === VotingMachineProposalState.NotCreated) {
        if (blockHash === ZERO_HASH) {
          ctx.logger.trace('votingScan: skip — voteConfig not bridged', { proposalId: id.toString() });
          return;
        }
        pendingNotCreated.push({ proposalId: id, state, blockHash });
        return;
      }
      if (state === VotingMachineProposalState.Finished) {
        decisions.set(id, { kind: 'closeAndSendVote', proposalId: id });
        return;
      }
      ctx.logger.trace('votingScan: no-op', {
        proposalId: id.toString(),
        state: votingProposalStateName(state),
      });
    });

    // For NotCreated ids: batch (hasRequiredRoots, getStorageRoots) with allowFailure=true
    // since hasRequiredRoots reverts when the strategy isn't fully populated yet.
    if (pendingNotCreated.length > 0) {
      const checks = await ctx.publicClient.multicall({
        contracts: pendingNotCreated.flatMap((p) => [
          {
            address: config.votingStrategy,
            abi: votingStrategyAbi,
            functionName: 'hasRequiredRoots' as const,
            args: [p.blockHash] as const,
          },
          {
            address: config.dataWarehouse,
            abi: dataWarehouseAbi,
            functionName: 'getStorageRoots' as const,
            args: [config.governance, p.blockHash] as const,
          },
        ]),
        allowFailure: true,
        multicallAddress: MULTICALL3_ADDRESS,
      });

      pendingNotCreated.forEach((p, i) => {
        const hasRoots = checks[i * 2]!;
        const govRoot = checks[i * 2 + 1]!;
        const ready =
          hasRoots.status === 'success' &&
          govRoot.status === 'success' &&
          govRoot.result !== ZERO_HASH;
        decisions.set(
          p.proposalId,
          ready
            ? { kind: 'createVote', proposalId: p.proposalId }
            : { kind: 'submitStorageRoots', proposalId: p.proposalId, l1ProposalBlockHash: p.blockHash },
        );
      });
    }

    let foundInBatch = 0;
    for (const id of ids) {
      const decision = decisions.get(id);
      if (decision) {
        ctx.logger.info('votingScan: action selected', {
          proposalId: id.toString(),
          kind: decision.kind,
        });
        collected.push(decision);
        foundInBatch += 1;
      }
    }

    if (foundInBatch === 0) break;
    skip += VOTING_SCAN_PAGE_SIZE;
  }

  ctx.logger.debug('votingScan: complete', { found: collected.length });
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
