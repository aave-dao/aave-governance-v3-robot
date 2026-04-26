import type { Address, Hex } from 'viem';
import type { RawBlock } from './proofs';

/**
 * Direct JSON-RPC client. We don't use viem's typed RPC for these methods because:
 *   - `eth_getBlockByHash`: viem normalizes the response, dropping post-Pectra fields we need for RLP.
 *   - `eth_getProof`: viem returns BigInts for `nonce`/`balance`, but we just need the raw hex proofs.
 */
export const jsonRpcCall = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> => {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed with HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string; code: number } };
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message} (${json.error.code})`);
  return json.result as T;
};

/** Fetch a block by hash with the un-normalized header fields needed for RLP encoding. */
export const getRawBlockByHash = (rpcUrl: string, blockHash: Hex): Promise<RawBlock> =>
  jsonRpcCall<RawBlock>(rpcUrl, 'eth_getBlockByHash', [blockHash, false]);

export type EthGetProofResult = {
  accountProof: Hex[];
  storageProof: Array<{ key: Hex; value: Hex; proof: Hex[] }>;
};

/** Fetch the account + storage proofs at a given block via `eth_getProof`. */
export const getProof = (
  rpcUrl: string,
  account: Address,
  storageKeys: Hex[],
  blockNumber: Hex,
): Promise<EthGetProofResult> =>
  jsonRpcCall<EthGetProofResult>(rpcUrl, 'eth_getProof', [account, storageKeys, blockNumber]);
