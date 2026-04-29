import { NextResponse, type NextRequest } from 'next/server';
import { notifyError } from '@robot/core/notify';
import { requireCronAuth } from './cron-auth';
import { recordCronRun } from './cron-runs';
import { getLogger } from './logger';
import { jsonSafe } from './serialize';

// Wraps a cron body with auth check, timing, cron_runs row insert, slack/telegram error notify,
// and consistent JSON response shape. The body returns whatever serializable summary it likes.
export const wrapCron = <T>(name: string, body: () => Promise<T>) => {
  return async (req: NextRequest): Promise<NextResponse> => {
    const denied = requireCronAuth(req);
    if (denied) return denied;

    const started = Date.now();
    try {
      const summary = await body();
      const durationMs = Date.now() - started;
      await recordCronRun({ name, ok: true, durationMs, summary });
      return NextResponse.json({ ok: true, summary: jsonSafe(summary) });
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      await recordCronRun({ name, ok: false, durationMs, error: message });
      await notifyError({ source: name, error: err, logger: getLogger() });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  };
};
