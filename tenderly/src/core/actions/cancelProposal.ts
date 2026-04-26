import type { Address } from 'viem';
import { governanceAbi, powerStrategyAbi } from '../abis';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext } from '../context';
import { ProposalState, proposalStateName, isProposalFinal } from '../state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

/**
 * Mirrors GovernanceChainRobotKeeper._canProposalBeCancelled:
 *   - state is non-final (Null < state < Executed)
 *   - creator's proposition power dropped below minPropositionPower * PRECISION_DIVIDER
 */
export const checkCancelProposal = async (
  ctx: ReadContext,
  proposalId: bigint,
): Promise<CheckResult> => {
  const [proposal, powerStrategyAddr, precisionDivider] = await Promise.all([
    ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [proposalId],
    }),
    ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'getPowerStrategy',
    }),
    ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'PRECISION_DIVIDER',
    }),
  ]);

  if (proposal.state === ProposalState.Null) {
    return { ok: false, reason: `state=Null` };
  }
  if (isProposalFinal(proposal.state)) {
    return { ok: false, reason: `state=${proposalStateName(proposal.state)} (final)` };
  }

  const config = await ctx.publicClient.readContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'getVotingConfig',
    args: [proposal.accessLevel],
  });

  const propositionPower = await ctx.publicClient.readContract({
    address: powerStrategyAddr as Address,
    abi: powerStrategyAbi,
    functionName: 'getFullPropositionPower',
    args: [proposal.creator],
  });

  const minRequired = BigInt(config.minPropositionPower) * precisionDivider;
  if (propositionPower >= minRequired) {
    return {
      ok: false,
      reason: `creator power ${propositionPower} >= min ${minRequired}`,
    };
  }

  return { ok: true };
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkCancelProposal(ctx, proposalId);
  if (!check.ok) throw new Error(`cancelProposal precheck failed: ${check.reason}`);

  ctx.logger.info('cancelProposal: sending tx', { proposalId: proposalId.toString() });
  const txHash = await ctx.walletClient.writeContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'cancelProposal',
    args: [proposalId],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.info('cancelProposal: submitted', { proposalId: proposalId.toString(), txHash });
  return { txHash };
};

export const cancelProposalAction: ActionModule<bigint> = {
  name: 'cancelProposal',
  check: checkCancelProposal,
  execute,
};
