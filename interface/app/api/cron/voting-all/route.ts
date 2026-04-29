import { runVotingScan } from '@robot/orchestration/votingScan';
import { VOTING_CHAINS, type VotingChainId } from '@robot/core/chains';
import { ethRpcUrlFromEnv, makeWriteContextFromEnv } from '@/lib/context-factory';
import { wrapCron } from '@/lib/cron-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = wrapCron('voting-all', async () => {
  const summaries: Array<{ chainId: number; chainName: string; results?: unknown; error?: string }> = [];
  for (const chainIdStr of Object.keys(VOTING_CHAINS)) {
    const chainId = Number(chainIdStr) as VotingChainId;
    const chainName = VOTING_CHAINS[chainId]!.name;
    try {
      const ctx = makeWriteContextFromEnv(chainId, chainName);
      const results = await runVotingScan({ ...ctx, ethRpcUrl: ethRpcUrlFromEnv() });
      summaries.push({ chainId, chainName, results });
    } catch (err) {
      summaries.push({
        chainId,
        chainName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { summaries };
});
