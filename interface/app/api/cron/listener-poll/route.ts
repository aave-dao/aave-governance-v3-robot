import { runListenerPoll } from '@/lib/listener';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = wrapCron('listener-poll', async () => runListenerPoll());
