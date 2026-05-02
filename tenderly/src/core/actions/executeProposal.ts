import type {Address} from 'viem';
import {MULTICALL3_ADDRESS, governanceAbi} from '../abis';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {notifyTxSuccess} from '../notify';
import {ProposalState, proposalStateName} from '../state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

/** Mirrors GovernanceChainRobotKeeper._canProposalBeExecuted. */
export const checkExecuteProposal = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<CheckResult> => {
  ctx.logger.trace('executeProposal: checking', {proposalId: proposalId.toString()});
  // 2 reads → 1 multicall.
  const [proposal, cooldown] = await ctx.publicClient.multicall({
    contracts: [
      {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'getProposal' as const,
        args: [proposalId] as const,
      },
      {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'COOLDOWN_PERIOD' as const,
      },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  ctx.logger.trace('executeProposal: state read', {
    state: proposalStateName(proposal.state),
    queuingTime: proposal.queuingTime,
    cooldown: cooldown.toString(),
  });

  if (proposal.state !== ProposalState.Queued) {
    return {ok: false, reason: `state=${proposalStateName(proposal.state)}, want Queued`};
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const earliest = BigInt(proposal.queuingTime) + cooldown;
  if (now < earliest) {
    return {
      ok: false,
      reason: `cooldown active (${earliest - now}s remaining; COOLDOWN_PERIOD=${cooldown}s)`,
    };
  }

  ctx.logger.debug('executeProposal: ready', {proposalId: proposalId.toString()});
  return {ok: true};
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkExecuteProposal(ctx, proposalId);
  if (!check.ok) throw new Error(`executeProposal precheck failed: ${check.reason}`);

  ctx.logger.info('executeProposal: sending tx', {proposalId: proposalId.toString()});
  const txHash = await ctx.walletClient.writeContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'executeProposal',
    args: [proposalId],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.info('executeProposal: submitted', {proposalId: proposalId.toString(), txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: 'ethereum',
    action: 'executeProposal',
    txHash,
    meta: {proposalId: proposalId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const executeProposalAction: ActionModule<bigint> = {
  name: 'executeProposal',
  check: checkExecuteProposal,
  execute,
};
