import type {Address} from 'viem';
import {governanceAbi} from '../abis';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {estimateGasWithMargin} from '../gas';
import {notifyTxSuccess} from '../notify';
import {ProposalState, proposalStateName} from '../state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

/** Mirrors GovernanceChainRobotKeeper._canVotingBeActivated. */
export const checkActivateVoting = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<CheckResult> => {
  ctx.logger.trace('activateVoting: checking', {proposalId: proposalId.toString()});
  const proposal = await ctx.publicClient.readContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });
  ctx.logger.trace('activateVoting: proposal read', {
    state: proposalStateName(proposal.state),
    accessLevel: proposal.accessLevel,
    creationTime: proposal.creationTime,
  });

  if (proposal.state !== ProposalState.Created) {
    return {ok: false, reason: `state=${proposalStateName(proposal.state)}, want Created`};
  }

  const config = await ctx.publicClient.readContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'getVotingConfig',
    args: [proposal.accessLevel],
  });

  const now = BigInt(Math.floor(Date.now() / 1000));
  const earliest = BigInt(proposal.creationTime) + BigInt(config.coolDownBeforeVotingStart);
  if (now <= earliest) {
    return {
      ok: false,
      reason: `cooldown active (${earliest - now}s remaining; coolDownBeforeVotingStart=${config.coolDownBeforeVotingStart}s)`,
    };
  }

  ctx.logger.debug('activateVoting: ready', {proposalId: proposalId.toString()});
  return {ok: true};
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkActivateVoting(ctx, proposalId);
  if (!check.ok) throw new Error(`activateVoting precheck failed: ${check.reason}`);

  ctx.logger.info('activateVoting: sending tx', {proposalId: proposalId.toString()});
  // 50% gas margin — activateVoting triggers a cross-chain msg to the voting chain.
  const call = {
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'activateVoting' as const,
    args: [proposalId] as const,
    account: ctx.walletClient.account!,
  };
  const gas = await estimateGasWithMargin(ctx.publicClient, call);
  const txHash = await ctx.walletClient.writeContract({
    ...call,
    chain: ctx.walletClient.chain!,
    gas,
  });
  ctx.logger.info('activateVoting: submitted', {proposalId: proposalId.toString(), txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: 'ethereum',
    action: 'activateVoting',
    txHash,
    meta: {proposalId: proposalId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const activateVotingAction: ActionModule<bigint> = {
  name: 'activateVoting',
  check: checkActivateVoting,
  execute,
};
