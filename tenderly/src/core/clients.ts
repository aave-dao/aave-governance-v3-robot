import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import * as viemChains from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getClient as toolboxGetClient,
  getRPCUrl as toolboxGetRpcUrl,
  getNetworkEnv,
} from '@bgd-labs/toolbox/browser';
import type { SupportedChainIds } from '@bgd-labs/toolbox';

/**
 * Chain reads use viem PublicClient via @bgd-labs/toolbox `getClient`, which respects:
 *   - explicit `RPC_<NETWORK>` env var (e.g. RPC_MAINNET, RPC_POLYGON)
 *   - falls back to Alchemy if `ALCHEMY_API_KEY` is set
 *   - falls back to the public RPC for the chain otherwise
 *
 * Both PublicClient and WalletClient are cached per chainId so we don't open multiple
 * transports unnecessarily during a single Tenderly Action invocation.
 */
const publicCache = new Map<number, PublicClient>();
const walletCache = new Map<string, WalletClient>(); // key = `${chainId}:${signerAddress}`

const viemChainByChainId = (chainId: number): Chain | undefined => {
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === 'object' && 'id' in (v as object) && (v as Chain).id === chainId) {
      return v as Chain;
    }
  }
  return undefined;
};

export const getRpcUrl = (chainId: number): string => {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const url = toolboxGetRpcUrl(chainId as SupportedChainIds, { alchemyKey });
  if (url) return url;

  // Toolbox doesn't know about this chain; fall back to viem default if any.
  const chain = viemChainByChainId(chainId);
  const fallback = chain?.rpcUrls.default.http[0];
  if (fallback) return fallback;

  let envName: string;
  try {
    envName = getNetworkEnv(chainId as SupportedChainIds);
  } catch {
    envName = `RPC_<NETWORK> for chainId ${chainId}`;
  }
  throw new Error(
    `No RPC available for chainId=${chainId}. Set ALCHEMY_API_KEY or ${envName} in the environment.`,
  );
};

export const getPublicClient = (chainId: number): PublicClient => {
  const hit = publicCache.get(chainId);
  if (hit) return hit;

  const alchemyKey = process.env.ALCHEMY_API_KEY;
  let client: PublicClient;
  try {
    client = toolboxGetClient(chainId as SupportedChainIds, {
      providerConfig: { alchemyKey },
    }) as unknown as PublicClient;
  } catch (toolboxErr) {
    // Chain isn't in toolbox's ChainList — build a viem client directly.
    const chain = viemChainByChainId(chainId);
    if (!chain) throw toolboxErr;
    const rpcUrl = process.env[`RPC_${chain.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`]
      ?? chain.rpcUrls.default.http[0];
    if (!rpcUrl) throw toolboxErr;
    client = createPublicClient({ chain, transport: http(rpcUrl) }) as unknown as PublicClient;
  }
  publicCache.set(chainId, client);
  return client;
};

export const getWalletClient = (chainId: number, privateKey: Hex): WalletClient => {
  const account = privateKeyToAccount(privateKey);
  const key = `${chainId}:${account.address.toLowerCase()}`;
  const hit = walletCache.get(key);
  if (hit) return hit;

  const rpcUrl = getRpcUrl(chainId);
  const chain = viemChainByChainId(chainId);
  // viem requires a Chain object on the wallet client; for unknown chains, synthesize a minimal one.
  const wcChain: Chain =
    chain ??
    ({
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as Chain);

  const client = createWalletClient({
    account,
    chain: wcChain,
    transport: http(rpcUrl),
  });
  walletCache.set(key, client);
  return client;
};

export const accountFromPrivateKey = (privateKey: Hex) => privateKeyToAccount(privateKey).address;

/** Reset caches — useful in tests or when secrets/env change between Tenderly invocations. */
export const __resetClientCaches = () => {
  publicCache.clear();
  walletCache.clear();
};
