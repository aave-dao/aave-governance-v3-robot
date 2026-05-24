import {dataWarehouseAbi, votingMachineAbi, votingStrategyAbi} from '../abis';
import {VOTING_CHAINS, type VotingChainId, type VotingChainConfig} from '../chains';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {estimateGasWithMargin} from '../gas';
import {notifyTxSuccess} from '../notify';
import {VotingMachineProposalState, votingProposalStateName} from '../state';

/**
 * Mirrors VotingChainRobotKeeper._hasRequiredRoots:
 *   - VotingStrategy.hasRequiredRoots(blockHash) does not revert (it returns void on success)
 *   - DataWarehouse.getStorageRoots(GOVERNANCE_L1, blockHash) != bytes32(0)
 */
export const hasRequiredRoots = async (
  ctx: ReadContext,
  config: VotingChainConfig,
  l1ProposalBlockHash: `0x${string}`,
): Promise<boolean> => {
  try {
    await ctx.publicClient.readContract({
      address: config.votingStrategy,
      abi: votingStrategyAbi,
      functionName: 'hasRequiredRoots',
      args: [l1ProposalBlockHash],
    });
  } catch {
    return false;
  }
  const govRoot = await ctx.publicClient.readContract({
    address: config.dataWarehouse,
    abi: dataWarehouseAbi,
    functionName: 'getStorageRoots',
    args: [config.governance, l1ProposalBlockHash],
  });
  return govRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000';
};

const requireVotingChain = (chainId: number): VotingChainConfig => {
  const config = VOTING_CHAINS[chainId as VotingChainId];
  if (!config) throw new Error(`chainId ${chainId} is not a voting chain`);
  return config;
};

/** Mirrors VotingChainRobotKeeper._canCreateVote. */
export const checkCreateVote = async (
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

  if (state !== VotingMachineProposalState.NotCreated) {
    return {ok: false, reason: `vm state=${votingProposalStateName(state)}, want NotCreated`};
  }

  const voteConfig = await ctx.publicClient.readContract({
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'getProposalVoteConfiguration',
    args: [proposalId],
  });
  const blockHash = voteConfig.l1ProposalBlockHash as `0x${string}`;
  if (blockHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return {ok: false, reason: 'voteConfig not yet bridged from L1'};
  }

  const ready = await hasRequiredRoots(ctx, config, blockHash);
  if (!ready) {
    return {ok: false, reason: `roots not yet registered for ${blockHash}`};
  }

  return {ok: true};
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkCreateVote(ctx, proposalId);
  if (!check.ok) throw new Error(`createVote precheck failed: ${check.reason}`);

  const config = requireVotingChain(ctx.chainId);
  ctx.logger.info('createVote: sending tx', {proposalId: proposalId.toString()});
  const call = {
    address: config.votingMachine,
    abi: votingMachineAbi,
    functionName: 'startProposalVote' as const,
    args: [proposalId] as const,
    account: ctx.walletClient.account!,
  };
  const gas = await estimateGasWithMargin(ctx.publicClient, call);
  const txHash = await ctx.walletClient.writeContract({
    ...call,
    chain: ctx.walletClient.chain!,
    gas,
  });
  ctx.logger.info('createVote: submitted', {proposalId: proposalId.toString(), txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: config.name,
    action: 'createVote',
    txHash,
    meta: {proposalId: proposalId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const createVoteAction: ActionModule<bigint> = {
  name: 'createVote',
  check: checkCreateVote,
  execute,
};
