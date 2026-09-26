// Lost-race handling. Several keepers (ours on Vercel + Tenderly, plus external ones) act on
// the same governance items, so a tx can revert, or fail its gas estimate, because another
// sender landed the same action a block earlier. That is not a failure worth alerting on:
// post the other sender's tx as the success notification instead, tagged with who did it.

import type {Abi, Address, Hex, PublicClient} from 'viem';
import type {ActionModule, ReadContext} from './context';
import {notifyTxSuccess} from './notify';

// Completion events are unique per id, so a wide window can't mis-match; it only has to
// cover fallback RPC nodes sitting at different heights.
const LOOKBACK_BLOCKS = 1000n;

export type Completion = {txHash: Hex; from: Address};

/** Block to start the completion search from. Read before the pre-send recheck. */
export const completionSearchStart = async (client: PublicClient): Promise<bigint> => {
  const head = await client.getBlockNumber();
  return head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
};

/** Find the tx that emitted `eventName` for this id since `fromBlock`, and its sender. */
export const findCompletionEvent = async (
  client: PublicClient,
  p: {
    address: Address;
    abi: Abi;
    eventName: string;
    args?: Record<string, unknown>;
    matches?: (args: Record<string, unknown>) => boolean;
    fromBlock: bigint;
  },
): Promise<Completion | null> => {
  const logs = (await client.getContractEvents({
    address: p.address,
    abi: p.abi,
    eventName: p.eventName,
    args: p.args,
    fromBlock: p.fromBlock,
    toBlock: 'latest',
  } as never)) as Array<{transactionHash: Hex | null; args: Record<string, unknown>}>;
  const hit = logs.filter((l) => l.transactionHash && (!p.matches || p.matches(l.args))).pop();
  if (!hit?.transactionHash) return null;
  const tx = await client.getTransaction({hash: hit.transactionHash});
  return {txHash: hit.transactionHash, from: tx.from};
};

/**
 * After a failed attempt: if the action is no longer applicable AND another sender's
 * completion event is on chain, post that tx as the success notification and return it.
 * Returns null for a real failure (still applicable, or no completion found), which the
 * caller alerts on as before. Lookup errors also return null so nothing is hidden.
 */
export const notifyIfFrontrun = async <Id>(
  ctx: ReadContext,
  action: ActionModule<Id>,
  id: Id,
  fromBlock: bigint,
  notify: {chainName?: string; meta?: Record<string, unknown>},
): Promise<Completion | null> => {
  if (!action.findCompletion) return null;
  try {
    const recheck = await action.check(ctx, id);
    if (recheck.ok) return null;
    const completion = await action.findCompletion(ctx, id, fromBlock);
    if (!completion) return null;
    ctx.logger.info(`${action.name}: frontrun`, {
      id: String(id),
      txHash: completion.txHash,
      from: completion.from,
    });
    await notifyTxSuccess({
      publicClient: ctx.publicClient,
      chainId: ctx.chainId,
      chainName: notify.chainName,
      action: action.name,
      txHash: completion.txHash,
      meta: notify.meta,
      frontrunBy: completion.from,
      logger: ctx.logger,
    });
    return completion;
  } catch (err) {
    ctx.logger.warn(`${action.name}: frontrun lookup failed`, {
      id: String(id),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};
