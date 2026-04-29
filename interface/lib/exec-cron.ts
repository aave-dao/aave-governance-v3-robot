import { runExecutionScan } from '@robot/orchestration/executionScan';
import { makeWriteContextFromEnv } from './context-factory';
import { wrapCron } from './cron-handler';

// Factory used by every per-execution-chain cron route.
export const makeExecCron = (chainId: number, chainName: string) =>
  wrapCron(`exec-scan-${chainName}`, async () => {
    const ctx = makeWriteContextFromEnv(chainId, chainName);
    const results = await runExecutionScan(ctx);
    return { chainId, chainName, results };
  });
