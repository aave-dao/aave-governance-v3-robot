import {votingMachineAbi} from '../abis';
import {VOTING_CHAINS, type VotingChainId, type VotingChainConfig} from '../chains';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {estimateGasWithMargin} from '../gas';
import {notifyTxSuccess} from '../notify';
import {VotingMachineProposalState, votingProposalStateName} from '../state';

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
    return {ok: false, reason: `vm state=${votingProposalStateName(state)}, want Finished`};
  }
  return {ok: true};
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkCloseAndSendVote(ctx, proposalId);
  if (!check.ok) throw new Error(`closeAndSendVote precheck failed: ${check.reason}`);

  const config = requireVotingChain(ctx.chainId);
  ctx.logger.info('closeAndSendVote: sending tx', {proposalId: proposalId.toString()});
  // 50% gas margin — closeAndSendVote sends an ADI cross-chain msg back to L1.
  const call = {
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'closeAndSendVote' as const,
    args: [proposalId] as const,
    account: ctx.walletClient.account!,
  };
  const gas = await estimateGasWithMargin(ctx.publicClient, call);
  const txHash = await ctx.walletClient.writeContract({
    ...call,
    chain: ctx.walletClient.chain!,
    gas,
  });
  ctx.logger.info('closeAndSendVote: submitted', {proposalId: proposalId.toString(), txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: config.name,
    action: 'closeAndSendVote',
    txHash,
    meta: {proposalId: proposalId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const closeAndSendVoteAction: ActionModule<bigint> = {
  name: 'closeAndSendVote',
  check: checkCloseAndSendVote,
  execute,
};
