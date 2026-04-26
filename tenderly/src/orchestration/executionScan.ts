import { payloadsControllerAbi } from '../core/abis';
import { EXECUTION_CHAINS } from '../core/chains';
import { executePayloadAction } from '../core/actions';
import type { ReadContext, WriteContext } from '../core/context';
import { PayloadState } from '../core/state';

/**
 * Mirrors ExecutionChainRobotKeeper scan:
 *   - Walk backwards from getPayloadsCount() - 1
 *   - Skip up to MAX_SKIP non-actionable payloads
 *   - Collect up to MAX_SHUFFLE_SIZE eligible payload IDs, then return them all (not just one).
 *     The on-chain keeper shuffles + returns 1 to dodge a single bad payload blocking the queue.
 *     We return the full list — failures don't block the rest because each tx is independent.
 */
export const MAX_EXECUTION_SKIP = 20;
export const MAX_EXECUTION_ACTIONS = 5;

const requireExecutionChain = (chainId: number) => {
  const config = EXECUTION_CHAINS[chainId];
  if (!config) throw new Error(`chainId ${chainId} has no PayloadsController configured`);
  return config;
};

export type ScannedPayload = { payloadId: bigint };

export const scanExecutionChain = async (ctx: ReadContext): Promise<ScannedPayload[]> => {
  const config = requireExecutionChain(ctx.chainId);
  const total = await ctx.publicClient.readContract({
    address: config.payloadsController,
    abi: payloadsControllerAbi,
    functionName: 'getPayloadsCount',
  });

  if (total === 0) return [];

  const found: ScannedPayload[] = [];
  let skipCount = 0;
  let i = total - 1;

  while (true) {
    if (skipCount > MAX_EXECUTION_SKIP) break;
    if (found.length >= MAX_EXECUTION_ACTIONS) break;

    const id = BigInt(i);
    const payload = await ctx.publicClient.readContract({
      address: config.payloadsController,
      abi: payloadsControllerAbi,
      functionName: 'getPayloadById',
      args: [i],
    });

    if (payload.state !== PayloadState.Queued) {
      skipCount += 1;
    } else {
      const check = await executePayloadAction.check(ctx, id);
      if (check.ok) {
        found.push({ payloadId: id });
        skipCount = 0;
      } else {
        skipCount += 1;
      }
    }

    if (i === 0) break;
    i -= 1;
  }

  return found;
};

export const runExecutionScan = async (
  ctx: WriteContext,
): Promise<Array<{ payloadId: bigint; txHash?: string; error?: string }>> => {
  const items = await scanExecutionChain(ctx);
  const results: Array<{ payloadId: bigint; txHash?: string; error?: string }> = [];
  for (const { payloadId } of items) {
    try {
      const recheck = await executePayloadAction.check(ctx, payloadId);
      if (!recheck.ok) {
        results.push({ payloadId, error: recheck.reason });
        continue;
      }
      const { txHash } = await executePayloadAction.execute(ctx, payloadId);
      results.push({ payloadId, txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error('executionScan: action failed', { payloadId: payloadId.toString(), error: msg });
      results.push({ payloadId, error: msg });
    }
  }
  return results;
};
