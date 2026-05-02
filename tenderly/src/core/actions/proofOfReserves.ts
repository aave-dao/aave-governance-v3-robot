import type {Address} from 'viem';
import {MULTICALL3_ADDRESS, proofOfReserveExecutorAbi} from '../abis';
import {PROOF_OF_RESERVE_CHAINS} from '../chains';
import type {ActionModule, CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {notifyTxSuccess} from '../notify';

/**
 * Replicates the on-chain Chainlink Automation keeper at
 * 0x7aE2930B50CFEbc99FE6DB16CE5B9C7D8d09332C (Avalanche). The keeper takes a
 * ProofOfReserveExecutor address as checkData and:
 *   - checkUpkeep:    !areAllReservesBacked() && isEmergencyActionPossible()
 *   - performUpkeep:  executeEmergencyAction()
 *
 * `isEmergencyActionPossible()` is the loop guard — once the executor has already
 * adjusted parameters (LTV=0 / freeze on V3, disable borrowing on V2), it returns
 * false so we don't re-execute. The keeper is registered once per executor; we
 * mirror that by treating the executor address as the action's identifier.
 */

const findExecutor = (
  chainId: number,
  executor: Address,
): {label: string; address: Address} | undefined => {
  const config = PROOF_OF_RESERVE_CHAINS[chainId];
  if (!config) return undefined;
  const lower = executor.toLowerCase();
  return config.executors.find((e) => e.address.toLowerCase() === lower);
};

const requireExecutor = (chainId: number, executor: Address): {label: string; address: Address} => {
  const found = findExecutor(chainId, executor);
  if (!found) {
    throw new Error(
      `executor ${executor} not registered in PROOF_OF_RESERVE_CHAINS[${chainId}] — ` +
        `add it to chains.ts to monitor it`,
    );
  }
  return found;
};

/**
 * Mirrors ProofOfReserveKeeper.checkUpkeep:
 *   - reserves backed → no action needed
 *   - emergency-action not possible → already adjusted (loop guard hit)
 *   - both flip negative → ready to fire
 */
export const checkProofOfReserves = async (
  ctx: ReadContext,
  executor: Address,
): Promise<CheckResult> => {
  requireExecutor(ctx.chainId, executor);
  ctx.logger.trace('proofOfReserves: checking', {executor});

  const [allBacked, emergencyPossible] = await ctx.publicClient.multicall({
    contracts: [
      {
        address: executor,
        abi: proofOfReserveExecutorAbi,
        functionName: 'areAllReservesBacked' as const,
      },
      {
        address: executor,
        abi: proofOfReserveExecutorAbi,
        functionName: 'isEmergencyActionPossible' as const,
      },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  ctx.logger.trace('proofOfReserves: read', {executor, allBacked, emergencyPossible});

  if (allBacked) return {ok: false, reason: 'all reserves backed'};
  if (!emergencyPossible) {
    return {ok: false, reason: 'emergency action already executed (loop guard)'};
  }
  return {ok: true};
};

const execute = async (ctx: WriteContext, executor: Address): Promise<ExecuteResult> => {
  const found = requireExecutor(ctx.chainId, executor);
  const check = await checkProofOfReserves(ctx, executor);
  if (!check.ok) throw new Error(`proofOfReserves precheck failed: ${check.reason}`);

  ctx.logger.warn('proofOfReserves: EMERGENCY — executing', {executor, label: found.label});
  const txHash = await ctx.walletClient.writeContract({
    address: executor,
    abi: proofOfReserveExecutorAbi,
    functionName: 'executeEmergencyAction',
    args: [],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
  });
  ctx.logger.warn('proofOfReserves: submitted', {executor, label: found.label, txHash});
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: PROOF_OF_RESERVE_CHAINS[ctx.chainId]?.name,
    action: `proofOfReserves[${found.label}]`,
    txHash,
    meta: {executor, label: found.label},
    logger: ctx.logger,
  });
  return {txHash};
};

export const proofOfReservesAction: ActionModule<Address> = {
  name: 'proofOfReserves',
  check: checkProofOfReserves,
  execute,
};
