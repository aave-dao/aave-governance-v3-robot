import {payloadsControllerAbi} from '../abis';
import {EXECUTION_CHAINS} from '../chains';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {isPayloadDisabled} from '../disabledPayloads';
import {estimateGasWithMargin} from '../gas';
import {notifyTxSuccess} from '../notify';
import {PayloadState, payloadStateName} from '../state';

const requireExecutionChain = (chainId: number) => {
  const config = EXECUTION_CHAINS[chainId];
  if (!config) throw new Error(`chainId ${chainId} has no PayloadsController configured`);
  return config;
};

/**
 * Mirrors ExecutionChainRobotKeeper._canPayloadBeExecuted:
 *   - state == Queued
 *   - block.timestamp > queuedAt + delay
 *   - (also reject if past expirationTime, mirroring on-chain executor behavior)
 */
export const checkExecutePayload = async (
  ctx: ReadContext,
  payloadId: bigint,
): Promise<CheckResult> => {
  const disabled = isPayloadDisabled(ctx.chainId, payloadId);
  if (disabled) return {ok: false, reason: `disabled: ${disabled.reason}`};

  const config = requireExecutionChain(ctx.chainId);
  const payload = await ctx.publicClient.readContract({
    address: config.payloadsController,
    abi: payloadsControllerAbi,
    functionName: 'getPayloadById',
    args: [Number(payloadId)],
  });

  if (payload.state !== PayloadState.Queued) {
    return {ok: false, reason: `state=${payloadStateName(payload.state)}, want Queued`};
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const earliest = BigInt(payload.queuedAt) + BigInt(payload.delay);
  if (now <= earliest) {
    return {ok: false, reason: `delay active (${earliest - now}s remaining)`};
  }

  if (payload.expirationTime > 0 && now > BigInt(payload.expirationTime)) {
    return {ok: false, reason: `payload expired at ${payload.expirationTime}`};
  }

  return {ok: true};
};

const execute = async (ctx: WriteContext, payloadId: bigint): Promise<ExecuteResult> => {
  const check = await checkExecutePayload(ctx, payloadId);
  if (!check.ok) throw new Error(`executePayload precheck failed: ${check.reason}`);

  const config = requireExecutionChain(ctx.chainId);
  ctx.logger.info('executePayload: sending tx', {
    payloadId: payloadId.toString(),
    chain: config.name,
  });
  // 50% gas margin — payload contents are arbitrary user code; the static estimate can
  // significantly understate cost under reentrant patterns or storage-state shifts.
  const call = {
    address: config.payloadsController,
    abi: payloadsControllerAbi,
    functionName: 'executePayload' as const,
    args: [Number(payloadId)] as const,
    account: ctx.walletClient.account!,
  };
  const gas = await estimateGasWithMargin(ctx.publicClient, call);
  const txHash = await ctx.walletClient.writeContract({
    ...call,
    chain: ctx.walletClient.chain!,
    gas,
  });
  ctx.logger.info('executePayload: submitted', {payloadId: payloadId.toString(), txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: config.name,
    action: 'executePayload',
    txHash,
    meta: {payloadId: payloadId.toString()},
    logger: ctx.logger,
  });
  return {txHash};
};

export const executePayloadAction: ActionModule<bigint> = {
  name: 'executePayload',
  check: checkExecutePayload,
  execute,
};
