import type {ActionFn, Context, Event} from '@tenderly/actions';
import {VOTING_CHAINS, type VotingChainId} from '../core/chains';
import {notifyError} from '../core/notify';
import {runVotingScan} from '../orchestration/votingScan';
import {setupChain, tenderlyLogger} from './runtime';

/**
 * Single Tenderly Action that scans every voting chain in sequence. Replaces what would
 * otherwise be one action per voting chain — Tenderly projects have a per-project action
 * limit and this keeps us comfortably under it.
 *
 * Each chain's failure is isolated (caught + logged + notified) so one bad RPC doesn't
 * stop the rest. The error is also pushed to Slack/Telegram if configured.
 */
export const votingAll: ActionFn = async (ctx: Context, _event: Event) => {
  const logger = tenderlyLogger().child({action: 'votingAll'});
  const ids = Object.keys(VOTING_CHAINS).map(Number) as VotingChainId[];
  for (const chainId of ids) {
    const config = VOTING_CHAINS[chainId]!;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      target.logger.info('votingAll: scan start', {chain: config.name});
      const results = await runVotingScan({...target.write, ethRpcUrl: target.ethRpcUrl});
      target.logger.info('votingAll: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      logger.error('votingAll: chain failed', {
        chain: config.name,
        chainId,
        error: err instanceof Error ? err.message : String(err),
      });
      await notifyError({
        source: 'votingAll',
        error: err,
        chainId,
        chainName: config.name,
        logger,
      });
    }
  }
};
