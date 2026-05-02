import type {Address, Hex} from 'viem';
import type {RawBlock} from './proofs';
import {redactSecrets} from './redact-secrets';

/**
 * Direct JSON-RPC client. We don't use viem's typed RPC for these methods because:
 *   - `eth_getBlockByHash`: viem normalizes the response, dropping post-Pectra fields we need for RLP.
 *   - `eth_getProof`: viem returns BigInts for `nonce`/`balance`, but we just need the raw hex proofs.
 *
 * Accepts either a single URL or an ordered list of fallback URLs. Transport-level failures
 * (fetch reject, non-2xx HTTP) advance to the next URL; well-formed JSON-RPC `error`
 * responses are returned to the caller — those are deterministic per-call and not provider
 * availability problems. Any URL substring in the final thrown error is redacted so callers
 * that log without their own redaction don't leak API keys.
 */
export const jsonRpcCall = async <T>(
  rpcUrls: string | string[],
  method: string,
  params: unknown[],
): Promise<T> => {
  const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
  if (urls.length === 0) throw new Error(`RPC ${method}: no URL provided`);

  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      });
      if (!res.ok) {
        lastErr = new Error(`RPC ${method} failed with HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {result?: T; error?: {message: string; code: number}};
      if (json.error) {
        // Deterministic per-call — don't retry on a different provider.
        throw new Error(
          redactSecrets(`RPC ${method} error: ${json.error.message} (${json.error.code})`),
        );
      }
      return json.result as T;
    } catch (err) {
      lastErr = err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(redactSecrets(`RPC ${method} failed across ${urls.length} provider(s): ${msg}`));
};

/** Fetch a block by hash with the un-normalized header fields needed for RLP encoding. */
export const getRawBlockByHash = (
  rpcUrls: string | string[],
  blockHash: Hex,
): Promise<RawBlock> =>
  jsonRpcCall<RawBlock>(rpcUrls, 'eth_getBlockByHash', [blockHash, false]);

export type EthGetProofResult = {
  /** Account state's storage trie root — the value DataWarehouse stores after verifying the proof. */
  storageHash: Hex;
  /** Account state's nonce, balance, codeHash — returned by every node, not used by us. */
  nonce: Hex;
  balance: Hex;
  codeHash: Hex;
  accountProof: Hex[];
  storageProof: Array<{key: Hex; value: Hex; proof: Hex[]}>;
};

/** Fetch the account + storage proofs at a given block via `eth_getProof`. */
export const getProof = (
  rpcUrls: string | string[],
  account: Address,
  storageKeys: Hex[],
  blockNumber: Hex,
): Promise<EthGetProofResult> =>
  jsonRpcCall<EthGetProofResult>(rpcUrls, 'eth_getProof', [account, storageKeys, blockNumber]);
