import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address} from 'viem';
import {MULTICALL3_ADDRESS, governanceAbi} from '../core/abis';
import {activateVotingAction, cancelProposalAction, executeProposalAction} from '../core/actions';
import type {ActionModule, ReadContext, WriteContext} from '../core/context';
import {notifyError} from '../core/notify';
import {isProposalFinal} from '../core/state';

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

/**
 * Worst-case examined count: MAX_ACTIONS finds each separated by MAX_SKIP non-actionable
 * items + a final MAX_SKIP+1 trailing skip allowance. We multicall up front for the latest
 * `SCAN_WINDOW` proposals (covers any realistic scan in one RPC) and rely on existing skip
 * logic to terminate inside the window.
 */
const SCAN_WINDOW = MAX_GOVERNANCE_ACTIONS * (MAX_GOVERNANCE_SKIP + 1) + MAX_GOVERNANCE_SKIP + 1;

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

  // Latest first, capped at SCAN_WINDOW or total — whichever is smaller.
  const ids: bigint[] = [];
  for (let n = 0; n < SCAN_WINDOW && BigInt(n) < total; n++) {
    ids.push(total - 1n - BigInt(n));
  }
  ctx.logger.debug('governanceScan: multicall fetch', {count: ids.length});
  const proposals = await ctx.publicClient.multicall({
    contracts: ids.map((id) => ({
      address: GOVERNANCE,
      abi: governanceAbi,
      functionName: 'getProposal' as const,
      args: [id] as const,
    })),
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  const found: ScannedAction[] = [];
  let skipCount = 0;
  let examined = 0;

  for (let idx = 0; idx < ids.length; idx++) {
    if (skipCount > MAX_GOVERNANCE_SKIP) {
      ctx.logger.debug('governanceScan: stop — skipCount exceeded', {skipCount, examined});
      break;
    }
    if (found.length >= MAX_GOVERNANCE_ACTIONS) {
      ctx.logger.debug('governanceScan: stop — actions cap reached', {found: found.length});
      break;
    }

    const i = ids[idx]!;
    const proposal = proposals[idx]!;
    examined += 1;
    ctx.logger.trace('governanceScan: examined', {
      proposalId: i.toString(),
      state: proposal.state,
      skipCount,
    });

    if (isProposalFinal(proposal.state)) {
      skipCount += 1;
      continue;
    }

    let matched = false;
    for (const action of GOV_PRIORITY) {
      // The action's check() does its own multicall — we don't have its full predicate state
      // here so we re-issue the read. This is still cheap because it only fires for
      // non-final proposals (rare).
      const check = await action.check(ctx, i);
      if (check.ok) {
        ctx.logger.info('governanceScan: action ready', {
          proposalId: i.toString(),
          action: action.name,
        });
        found.push({proposalId: i, action, reason: action.name});
        skipCount = 0;
        matched = true;
        break;
      }
    }
    if (!matched) skipCount += 1;
  }

  ctx.logger.debug('governanceScan: complete', {examined, found: found.length});
  return found;
};

/**
 * Run scan + execute. Re-runs each action's `check` immediately before sending the tx
 * to minimize wasted gas when racing against the Chainlink keeper.
 */
export const runGovernanceScan = async (
  ctx: WriteContext,
): Promise<Array<{proposalId: bigint; action: string; txHash?: string; error?: string}>> => {
  const scanned = await scanGovernanceChain(ctx);
  const results: Array<{proposalId: bigint; action: string; txHash?: string; error?: string}> = [];
  for (const item of scanned) {
    try {
      const recheck = await item.action.check(ctx, item.proposalId);
      if (!recheck.ok) {
        ctx.logger.info('governanceScan: skipping after recheck', {
          proposalId: item.proposalId.toString(),
          action: item.action.name,
          reason: recheck.reason,
        });
        results.push({
          proposalId: item.proposalId,
          action: item.action.name,
          error: recheck.reason,
        });
        continue;
      }
      const {txHash} = await item.action.execute(ctx, item.proposalId);
      results.push({proposalId: item.proposalId, action: item.action.name, txHash});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error('governanceScan: action failed', {
        proposalId: item.proposalId.toString(),
        action: item.action.name,
        error: msg,
      });
      // Surface per-item failures to Slack/Telegram. The outer cron wrapper only notifies
      // when the whole run throws — without this call, a tx that broadcasts then reverts
      // (or fails to broadcast) would be silently buried in the results summary.
      await notifyError({
        source: item.action.name,
        error: err,
        chainId: ctx.chainId,
        meta: {proposalId: item.proposalId.toString()},
        logger: ctx.logger,
      });
      results.push({proposalId: item.proposalId, action: item.action.name, error: msg});
    }
  }
  return results;
};
