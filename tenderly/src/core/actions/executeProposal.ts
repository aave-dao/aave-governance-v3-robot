import type { Address } from 'viem';
import { governanceAbi } from '../abis';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext } from '../context';
import { ProposalState, proposalStateName } from '../state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

/** Mirrors GovernanceChainRobotKeeper._canProposalBeExecuted. */
export const checkExecuteProposal = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<CheckResult> => {
  ctx.logger.trace('executeProposal: checking', { proposalId: proposalId.toString() });
  const [proposal, cooldown] = await Promise.all([
    ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [proposalId],
    }),
    ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'COOLDOWN_PERIOD',
    }),
  ]);
  ctx.logger.trace('executeProposal: state read', {
    state: proposalStateName(proposal.state),
    queuingTime: proposal.queuingTime,
    cooldown: cooldown.toString(),
  });

  if (proposal.state !== ProposalState.Queued) {
    return { ok: false, reason: `state=${proposalStateName(proposal.state)}, want Queued` };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const earliest = BigInt(proposal.queuingTime) + cooldown;
  if (now < earliest) {
    return {
      ok: false,
      reason: `cooldown active (${earliest - now}s remaining; COOLDOWN_PERIOD=${cooldown}s)`,
    };
  }

  ctx.logger.debug('executeProposal: ready', { proposalId: proposalId.toString() });
  return { ok: true };
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkExecuteProposal(ctx, proposalId);
  if (!check.ok) throw new Error(`executeProposal precheck failed: ${check.reason}`);

  ctx.logger.info('executeProposal: sending tx', { proposalId: proposalId.toString() });
  const txHash = await ctx.walletClient.writeContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'executeProposal',
    args: [proposalId],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.info('executeProposal: submitted', { proposalId: proposalId.toString(), txHash });
  return { txHash };
};

export const executeProposalAction: ActionModule<bigint> = {
  name: 'executeProposal',
  check: checkExecuteProposal,
  execute,
};
