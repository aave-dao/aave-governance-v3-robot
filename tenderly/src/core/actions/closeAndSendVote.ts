import { votingMachineAbi } from '../abis';
import { VOTING_CHAINS, type VotingChainId, type VotingChainConfig } from '../chains';
import type { ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext } from '../context';
import { VotingMachineProposalState, votingProposalStateName } from '../state';

const requireVotingChain = (chainId: number): VotingChainConfig => {
  const config = VOTING_CHAINS[chainId as VotingChainId];
  if (!config) throw new Error(`chainId ${chainId} is not a voting chain`);
  return config;
};

/**
 * Mirrors VotingChainRobotKeeper._canCloseAndSendVote.
 *
 * Note: the on-chain getProposalState() already encodes the time check (it returns
 * `Active` while voting is still open and `Finished` only once endTime has passed),
 * so we don't need to re-check timestamps here.
 */
export const checkCloseAndSendVote = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<CheckResult> => {
  const config = requireVotingChain(ctx.chainId);
  const state = await ctx.publicClient.readContract({
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'getProposalState',
    args: [proposalId],
  });
  if (state !== VotingMachineProposalState.Finished) {
    return { ok: false, reason: `vm state=${votingProposalStateName(state)}, want Finished` };
  }
  return { ok: true };
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkCloseAndSendVote(ctx, proposalId);
  if (!check.ok) throw new Error(`closeAndSendVote precheck failed: ${check.reason}`);

  const config = requireVotingChain(ctx.chainId);
  ctx.logger.info('closeAndSendVote: sending tx', { proposalId: proposalId.toString() });
  const txHash = await ctx.walletClient.writeContract({
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'closeAndSendVote',
    args: [proposalId],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.info('closeAndSendVote: submitted', { proposalId: proposalId.toString(), txHash });
  return { txHash };
};

export const closeAndSendVoteAction: ActionModule<bigint> = {
  name: 'closeAndSendVote',
  check: checkCloseAndSendVote,
  execute,
};
