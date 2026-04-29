import { GovernanceV3Avalanche } from '@aave-dao/aave-address-book';
import { makeExecCron } from '@/lib/exec-cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = makeExecCron(GovernanceV3Avalanche.CHAIN_ID, 'avalanche');
