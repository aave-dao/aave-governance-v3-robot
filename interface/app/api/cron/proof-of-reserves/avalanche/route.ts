import { GovernanceV3Avalanche } from '@aave-dao/aave-address-book';
import { runProofOfReservesScan } from '@robot/orchestration/proofOfReservesScan';
import { makeWriteContextFromEnv } from '@/lib/context-factory';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHAIN_ID = GovernanceV3Avalanche.CHAIN_ID;
const CHAIN_NAME = 'avalanche';

export const GET = wrapCron(`proof-of-reserves-${CHAIN_NAME}`, async () => {
  const ctx = makeWriteContextFromEnv(CHAIN_ID, CHAIN_NAME);
  const results = await runProofOfReservesScan(ctx);
  return { chainId: CHAIN_ID, chainName: CHAIN_NAME, results };
});
