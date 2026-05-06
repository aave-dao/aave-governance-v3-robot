import type {Address} from 'viem';
import {proofOfReservesAction} from '../core/actions';
import {PROOF_OF_RESERVE_CHAINS} from '../core/chains';
import type {ReadContext, WriteContext} from '../core/context';
import {notifyError} from '../core/notify';

export type ScannedExecutor = {executor: Address; label: string};

/**
 * Iterate the executors configured for this chain and return the ones whose check passes.
 * Runs them in parallel — the underlying multicall is two view reads; serialization isn't
 * worth it. Each executor is independent so a failed read on one doesn't block the others.
 */
export const scanProofOfReserves = async (ctx: ReadContext): Promise<ScannedExecutor[]> => {
  const config = PROOF_OF_RESERVE_CHAINS[ctx.chainId];
  if (!config) return [];

  const checks = await Promise.all(
    config.executors.map(async (e) => {
      try {
        const result = await proofOfReservesAction.check(ctx, e.address);
        return {entry: e, result};
      } catch (err) {
        ctx.logger.warn('proofOfReservesScan: check failed', {
          executor: e.address,
          label: e.label,
          error: err instanceof Error ? err.message : String(err),
        });
        return {entry: e, result: {ok: false as const, reason: 'check threw'}};
      }
    }),
  );

  const ready: ScannedExecutor[] = [];
  for (const c of checks) {
    if (c.result.ok) {
      ctx.logger.warn('proofOfReservesScan: emergency ready', {
        executor: c.entry.address,
        label: c.entry.label,
      });
      ready.push({executor: c.entry.address, label: c.entry.label});
    } else {
      ctx.logger.debug('proofOfReservesScan: skip', {
        executor: c.entry.address,
        label: c.entry.label,
        reason: c.result.reason,
      });
    }
  }
  return ready;
};

export const runProofOfReservesScan = async (
  ctx: WriteContext,
): Promise<Array<{executor: Address; label: string; txHash?: string; error?: string}>> => {
  const items = await scanProofOfReserves(ctx);
  const results: Array<{executor: Address; label: string; txHash?: string; error?: string}> = [];
  for (const {executor, label} of items) {
    try {
      // Re-check immediately before writing — the executor's emergency-action flag can flip
      // between scan and execute (another keeper, a manual call). Re-running cheap reads
      // avoids racing into a revert.
      const recheck = await proofOfReservesAction.check(ctx, executor);
      if (!recheck.ok) {
        results.push({executor, label, error: recheck.reason});
        continue;
      }
      const {txHash} = await proofOfReservesAction.execute(ctx, executor);
      results.push({executor, label, txHash});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error('proofOfReservesScan: action failed', {executor, label, error: msg});
      // Surface per-item failures to Slack/Telegram. The outer cron wrapper only notifies
      // when the whole run throws — without this call, a tx that broadcasts then reverts
      // (or fails to broadcast) would be silently buried in the results summary.
      await notifyError({
        source: 'proofOfReserves',
        error: err,
        chainId: ctx.chainId,
        meta: {executor, label},
        logger: ctx.logger,
      });
      results.push({executor, label, error: msg});
    }
  }
  return results;
};
