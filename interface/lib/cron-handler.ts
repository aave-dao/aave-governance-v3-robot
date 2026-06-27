import { NextResponse, type NextRequest } from 'next/server';
import { notifyError } from '@robot/core/notify';
import { requireCronAuth } from './cron-auth';
import { formatError } from './format-error';
import { getLogger } from './logger';
// Side-effect import: installs the Postgres-backed dedupe store onto `notifyError`.
import './notify-dedupe-store';
import { jsonSafe } from './serialize';

// Wraps a cron body with auth check, slack/telegram error notify, and consistent JSON response
// shape. The body returns whatever serializable summary it likes. We don't persist run history —
// Vercel's function logs capture the per-invocation summary we log here, and failures fan out
// to Slack/Telegram via notifyError.
export const wrapCron = <T>(name: string, body: () => Promise<T>) => {
  return async (req: NextRequest): Promise<NextResponse> => {
    const denied = requireCronAuth(req);
    if (denied) return denied;

    const logger = getLogger().child({ cron: name });
    const started = Date.now();
    try {
      const summary = await body();
      const durationMs = Date.now() - started;
      logger.info('cron ok', { ok: true, durationMs, summary: jsonSafe(summary) });
      return NextResponse.json({ ok: true, summary: jsonSafe(summary) });
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = formatError(err);
      logger.error('cron failed', { ok: false, durationMs, error: message });
      await notifyError({ source: name, error: err, logger });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  };
};
