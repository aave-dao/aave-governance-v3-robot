import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { Address } from 'viem';
import { governanceAbi } from '../core/abis';
import {
  activateVotingAction,
  cancelProposalAction,
  executeProposalAction,
} from '../core/actions';
import type { ActionModule, ReadContext, WriteContext } from '../core/context';
import { isProposalFinal } from '../core/state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

/**
 * Mirrors GovernanceChainRobotKeeper scan logic:
 *   - Walk backwards from getProposalsCount() - 1
 *   - Skip up to MAX_SKIP non-actionable proposals
 *   - Stop after collecting MAX_ACTIONS actions
 *   - skipCount resets to 0 every time we find a hit (so sparse pending proposals are still found)
 *
 * The action list per proposal is evaluated in priority order: cancel > activate > execute,
 * matching the on-chain keeper.
 */
export const MAX_GOVERNANCE_SKIP = 20;
export const MAX_GOVERNANCE_ACTIONS = 5;

export type ScannedAction = {
  proposalId: bigint;
  action: ActionModule<bigint>;
  reason: string;
};

const GOV_PRIORITY: ActionModule<bigint>[] = [
  cancelProposalAction,
  activateVotingAction,
  executeProposalAction,
];

export const scanGovernanceChain = async (ctx: ReadContext): Promise<ScannedAction[]> => {
  const total = await ctx.publicClient.readContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'getProposalsCount',
  });
  ctx.logger.debug('governanceScan: starting', {
    totalProposals: total.toString(),
    maxSkip: MAX_GOVERNANCE_SKIP,
    maxActions: MAX_GOVERNANCE_ACTIONS,
  });

  if (total === 0n) return [];

  const found: ScannedAction[] = [];
  let skipCount = 0;
  let i = total - 1n;
  let examined = 0;

  while (true) {
    if (skipCount > MAX_GOVERNANCE_SKIP) {
      ctx.logger.debug('governanceScan: stop — skipCount exceeded', { skipCount, examined });
      break;
    }
    if (found.length >= MAX_GOVERNANCE_ACTIONS) {
      ctx.logger.debug('governanceScan: stop — actions cap reached', { found: found.length });
      break;
    }

    const proposal = await ctx.publicClient.readContract({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [i],
    });
    examined += 1;
    ctx.logger.trace('governanceScan: examined', {
      proposalId: i.toString(),
      state: proposal.state,
      skipCount,
    });

    if (isProposalFinal(proposal.state)) {
      skipCount += 1;
    } else {
      let matched = false;
      for (const action of GOV_PRIORITY) {
        const check = await action.check(ctx, i);
        if (check.ok) {
          ctx.logger.info('governanceScan: action ready', {
            proposalId: i.toString(),
            action: action.name,
          });
          found.push({ proposalId: i, action, reason: action.name });
          skipCount = 0;
          matched = true;
          break;
        }
      }
      if (!matched) skipCount += 1;
    }

    if (i === 0n) break;
    i -= 1n;
  }

  ctx.logger.debug('governanceScan: complete', { examined, found: found.length });
  return found;
};

/**
 * Run scan + execute. Re-runs each action's `check` immediately before sending the tx
 * to minimize wasted gas when racing against the Chainlink keeper.
 */
export const runGovernanceScan = async (
  ctx: WriteContext,
): Promise<Array<{ proposalId: bigint; action: string; txHash?: string; error?: string }>> => {
  const scanned = await scanGovernanceChain(ctx);
  const results: Array<{ proposalId: bigint; action: string; txHash?: string; error?: string }> = [];
  for (const item of scanned) {
    try {
      const recheck = await item.action.check(ctx, item.proposalId);
      if (!recheck.ok) {
        ctx.logger.info('governanceScan: skipping after recheck', {
          proposalId: item.proposalId.toString(),
          action: item.action.name,
          reason: recheck.reason,
        });
        results.push({ proposalId: item.proposalId, action: item.action.name, error: recheck.reason });
        continue;
      }
      const { txHash } = await item.action.execute(ctx, item.proposalId);
      results.push({ proposalId: item.proposalId, action: item.action.name, txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error('governanceScan: action failed', {
        proposalId: item.proposalId.toString(),
        action: item.action.name,
        error: msg,
      });
      results.push({ proposalId: item.proposalId, action: item.action.name, error: msg });
    }
  }
  return results;
};
