import { runCacheRefresh } from '@/lib/refresh';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = wrapCron('cache-refresh', async () => runCacheRefresh());
