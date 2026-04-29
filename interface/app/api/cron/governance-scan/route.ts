import { runGovernanceScan } from '@robot/orchestration/governanceScan';
import { GOVERNANCE_CHAIN_ID } from '@robot/core/chains';
import { makeWriteContextFromEnv } from '@/lib/context-factory';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = wrapCron('governance-scan', async () => {
  const ctx = makeWriteContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
  const results = await runGovernanceScan(ctx);
  return { results };
});
