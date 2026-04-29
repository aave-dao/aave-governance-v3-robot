import { collectHealth, formatHealthAlert } from '@robot/cli/health';
import { notifyHealth } from '@robot/core/notify';
import { requirePrivateKey } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_ROUNDS = 50;

export const GET = wrapCron('health-daily', async () => {
  const logger = getLogger();
  const rows = await collectHealth(requirePrivateKey(), logger, { minRounds: MIN_ROUNDS });
  const alert = formatHealthAlert(rows, { minRounds: MIN_ROUNDS });
  let posted = false;
  if (alert) {
    await notifyHealth({ ...alert, logger });
    posted = true;
  }
  return {
    posted,
    chains: rows.map((r) => ({
      chainId: r.chainId,
      name: r.name,
      status: r.status,
      rounds: r.rounds === Infinity ? null : r.rounds,
      balanceWei: r.balanceWei.toString(),
      gasPriceWei: r.gasPriceWei.toString(),
    })),
  };
});
