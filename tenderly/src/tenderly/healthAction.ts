import type {ActionFn, Context, Event} from '@tenderly/actions';
import {collectHealth, formatHealthAlert} from '../cli/health';
import {notifyError, notifyHealth} from '../core/notify';
import {hydrateSecrets} from './secrets';
import {tenderlyLogger} from './runtime';

/**
 * Daily Tenderly Action — checks the signer's balance and gas-cost-per-action-round on
 * every chain we sign on. Stays silent if every chain is healthy; posts a single grouped
 * Slack/Telegram alert if any chain is below threshold or its probe failed.
 *
 * The threshold mirrors the CLI default (`bun run robot health` / `notify`).
 */
const MIN_ROUNDS = 10;

export const healthAction: ActionFn = async (ctx: Context, _event: Event) => {
  const logger = tenderlyLogger().child({action: 'healthAction'});
  try {
    const {privateKey} = await hydrateSecrets(ctx);
    const rows = await collectHealth(privateKey, logger, {minRounds: MIN_ROUNDS});
    const alert = formatHealthAlert(rows, {minRounds: MIN_ROUNDS});
    if (!alert) {
      logger.info('healthAction: all chains healthy, silent exit', {chains: rows.length});
      return;
    }
    await notifyHealth({...alert, logger});
    logger.info('healthAction: posted health alert', {
      warnChains: rows.filter((r) => r.status === 'warn' || r.status === 'critical').length,
      errorChains: rows.filter((r) => r.status === 'error').length,
    });
  } catch (err) {
    await notifyError({source: 'healthAction', error: err, logger});
    throw err; // preserve Tenderly's own failure recording
  }
};
