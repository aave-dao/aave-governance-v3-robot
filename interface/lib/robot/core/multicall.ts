import {encodeFunctionData, type Address, type Hex, type WalletClient} from 'viem';
import {multicall3Abi, MULTICALL3_ADDRESS} from './abis';

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
 */
export const sendAggregate3 = async (walletClient: WalletClient, calls: Call3[]): Promise<Hex> => {
  const account = walletClient.account;
  if (!account) throw new Error('walletClient has no account configured');
  const chain = walletClient.chain;
  if (!chain) throw new Error('walletClient has no chain configured');
  return walletClient.writeContract({
    address: MULTICALL3_ADDRESS,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [calls],
    account,
    chain,
  });
};
