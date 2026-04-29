import type {Address} from 'viem';
import {MULTICALL3_ADDRESS, governanceAbi, powerStrategyAbi} from '../abis';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {formatAave} from '../format';
import {notifyTxSuccess} from '../notify';
import {ProposalState, proposalStateName, isProposalFinal} from '../state';

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
  // Phase 1: read proposal + governance constants in one multicall (3 reads → 1).
  const [proposal, powerStrategyAddr, precisionDivider] = await ctx.publicClient.multicall({
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
        functionName: 'getPowerStrategy' as const,
      },
      {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'PRECISION_DIVIDER' as const,
      },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  if (proposal.state === ProposalState.Null) {
    return {ok: false, reason: `state=Null`};
  }
  if (isProposalFinal(proposal.state)) {
    return {ok: false, reason: `state=${proposalStateName(proposal.state)} (final)`};
  }

  // Phase 2: votingConfig (depends on proposal.accessLevel) + propositionPower (depends on
  // powerStrategy address). Batched together (2 reads → 1).
  const [config, propositionPower] = await ctx.publicClient.multicall({
    contracts: [
      {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'getVotingConfig' as const,
        args: [proposal.accessLevel] as const,
      },
      {
        address: powerStrategyAddr as Address,
        abi: powerStrategyAbi,
        functionName: 'getFullPropositionPower' as const,
        args: [proposal.creator] as const,
      },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  const minRequired = BigInt(config.minPropositionPower) * precisionDivider;
  if (propositionPower >= minRequired) {
    return {
      ok: false,
      reason: `creator power ${formatAave(propositionPower)} >= min ${formatAave(minRequired)}`,
    };
  }

  return {ok: true};
};

const execute = async (ctx: WriteContext, proposalId: bigint): Promise<ExecuteResult> => {
  const check = await checkCancelProposal(ctx, proposalId);
  if (!check.ok) throw new Error(`cancelProposal precheck failed: ${check.reason}`);

  ctx.logger.info('cancelProposal: sending tx', {proposalId: proposalId.toString()});
  const txHash = await ctx.walletClient.writeContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'cancelProposal',
    args: [proposalId],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.info('cancelProposal: submitted', {proposalId: proposalId.toString(), txHash});
  await notifyTxSuccess({
    chainId: ctx.chainId,
    chainName: 'ethereum',
    action: 'cancelProposal',
    txHash,
    meta: {proposalId: proposalId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const cancelProposalAction: ActionModule<bigint> = {
  name: 'cancelProposal',
  check: checkCancelProposal,
  execute,
};
