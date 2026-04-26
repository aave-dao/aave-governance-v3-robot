import type { ActionFn, Context, Event } from '@tenderly/actions';
import { GOVERNANCE_CHAIN_ID } from '../core/chains';
import { runGovernanceScan } from '../orchestration/governanceScan';
import { setupChain } from './runtime';

/**
 * Periodic Tenderly Action for the governance chain.
 *
 * Triggered by a periodic schedule (see tenderly.yaml). Scans the latest 25 governance
 * proposals for any actionable item (activate/execute/cancel) and submits them.
 */
export const governanceAction: ActionFn = async (ctx: Context, _event: Event) => {
  const { write, logger } = await setupChain(ctx, GOVERNANCE_CHAIN_ID, 'ethereum');
  logger.info('governanceAction: scan start');
  const results = await runGovernanceScan(write);
  logger.info('governanceAction: scan done', {
    actions: results.length,
    txs: results.filter((r) => r.txHash).length,
  });
};
