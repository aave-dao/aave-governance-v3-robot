import type {ActionFn, Context, Event} from '@tenderly/actions';
import {EXECUTION_CHAINS} from '../core/chains';
import {runExecutionScan} from '../orchestration/executionScan';
import {setupChain, tenderlyLogger} from './runtime';

/**
 * Single Tenderly Action that scans every execution chain in sequence. Same rationale as
 * `votingAll` — keeps us under Tenderly's per-project action limit.
 *
 * Per-chain failure is isolated.
 */
export const executionAll: ActionFn = async (ctx: Context, _event: Event) => {
  const logger = tenderlyLogger().child({action: 'executionAll'});
  const ids = Object.keys(EXECUTION_CHAINS).map(Number);
  for (const chainId of ids) {
    const config = EXECUTION_CHAINS[chainId]!;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      target.logger.info('executionAll: scan start', {chain: config.name});
      const results = await runExecutionScan(target.write);
      target.logger.info('executionAll: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      logger.error('executionAll: chain failed', {
        chain: config.name,
        chainId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
