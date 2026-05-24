import {encodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient} from 'viem';
import {multicall3Abi, MULTICALL3_ADDRESS} from './abis';
import {estimateGasWithMargin} from './gas';

export type Call3 = {target: Address; allowFailure: boolean; callData: Hex};

/** Encode a batch into Multicall3.aggregate3 calldata. */
export const encodeAggregate3 = (calls: Call3[]): Hex =>
  encodeFunctionData({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [calls],
  });

/**
 * Send `aggregate3([...calls])` to the canonical Multicall3 deployment. Each `Call3` carries
 * its own `allowFailure` flag — `false` is the default we want for our writes, so any inner
 * revert aborts the whole tx and surfaces via the caller's catch / notifyError pipeline.
 * Setting `allowFailure: true` on a write makes Multicall3 silently absorb the revert and
 * return `{success: false}` — only do that if you ACTUALLY plan to inspect each return.
 *
 * Requires a `publicClient` so we can pre-estimate gas and add the standard safety margin
 * (see `gas.ts`). Without this, batched writes can hit OOG on the per-call 63/64 sub-call
 * boundary just like top-level writes can.
 */
export const sendAggregate3 = async (
  publicClient: PublicClient,
  walletClient: WalletClient,
  calls: Call3[],
): Promise<Hex> => {
  const account = walletClient.account;
  if (!account) throw new Error('walletClient has no account configured');
  const chain = walletClient.chain;
  if (!chain) throw new Error('walletClient has no chain configured');
  const call = {
    address: MULTICALL3_ADDRESS,
    abi: multicall3Abi,
    functionName: 'aggregate3' as const,
    args: [calls] as const,
    account,
  };
  const gas = await estimateGasWithMargin(publicClient, call);
  return walletClient.writeContract({
    ...call,
    chain,
    gas,
  });
};
