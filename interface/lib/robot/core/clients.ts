import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Chain,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import * as viemChains from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {
  getRPCUrl as toolboxGetRpcUrl,
  getNetworkEnv,
} from '@aave-dao/toolbox/browser';
import type {SupportedChainIds} from '@aave-dao/toolbox';

/**
 * RPC URL resolution + transport construction for both PublicClient and WalletClient.
 *
 * Each chain gets a viem `fallback()` transport composed in this order:
 *   1. Explicit `RPC_<NETWORK>` env var (toolbox routes Alchemy/Infura/etc here too).
 *   2. Toolbox-resolved URL (Alchemy via ALCHEMY_API_KEY).
 *   3. Tenderly Gateway URL (per-chain slug + TENDERLY_GATEWAY_KEY) — supports much larger
 *      `eth_getLogs` ranges than viem's public defaults, which matters for the lifecycle
 *      indexer's wide event scans.
 *   4. Viem's chain-default public RPCs (last-resort; usually rate-limited and capped).
 *
 * Any single transport that times out or returns a 5xx is automatically retried on the next
 * URL in the list. With Alchemy as primary and Tenderly as a beefy backup, a transient
 * Alchemy hiccup doesn't drop us straight onto a 2048-block-limited public node.
 *
 * Clients are memoized per chainId / signer so a single Tenderly Action invocation doesn't
 * open multiple transports.
 */

/**
 * Default Tenderly Gateway API key. Override with `TENDERLY_GATEWAY_KEY` env var.
 *
 * Per-chain slugs probed and verified against the live gateway — chains absent from this
 * map (currently just BNB / chain 56) aren't supported by Tenderly Gateway and skip the
 * Tenderly fallback. To extend, hit `https://<slug>.gateway.tenderly.co/<key>` with
 * `eth_blockNumber`; if it returns a result the slug is live.
 */
const TENDERLY_GATEWAY_KEY_DEFAULT = '7OkquWA8RZvYUIuM5i2K4d';

const TENDERLY_SLUG_BY_CHAIN_ID: Record<number, string> = {
  1: 'mainnet',
  10: 'optimism',
  100: 'gnosis',
  137: 'polygon',
  146: 'sonic',
  196: 'xlayer',
  324: 'zksync',
  1088: 'metis-andromeda',
  1868: 'soneium',
  4326: 'megaeth',
  5000: 'mantle',
  8453: 'base',
  9745: 'plasma',
  42161: 'arbitrum',
  42220: 'celo',
  43114: 'avalanche',
  57073: 'ink',
  59144: 'linea',
  534352: 'scroll-mainnet',
  // 56 (BNB) intentionally omitted — Tenderly Gateway returns 404 for every BNB slug.
};

const tenderlyGatewayUrl = (chainId: number): string | undefined => {
  const slug = TENDERLY_SLUG_BY_CHAIN_ID[chainId];
  if (!slug) return undefined;
  const key = process.env.TENDERLY_GATEWAY_KEY ?? TENDERLY_GATEWAY_KEY_DEFAULT;
  if (!key) return undefined;
  return `https://${slug}.gateway.tenderly.co/${key}`;
};
const publicCache = new Map<number, PublicClient>();
const walletCache = new Map<string, WalletClient>(); // key = `${chainId}:${signerAddress}`

const HTTP_TIMEOUT_MS = 12_000;
const PER_TRANSPORT_RETRIES = 0; // fallback handles cross-provider retries; don't double up.
const FALLBACK_RETRY_COUNT = 1; // each call may try up to 2 providers in total.

const viemChainByChainId = (chainId: number): Chain | undefined => {
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === 'object' && 'id' in (v as object) && (v as Chain).id === chainId) {
      return v as Chain;
    }
  }
  return undefined;
};

/**
 * Identify which provider returned a URL for a given chain — surfaced by callers at debug
 * level so we can tell at a glance whether toolbox routed to Alchemy, an explicit env var,
 * or the public-RPC fallback.
 */
export const describeRpcSource = (chainId: number, url: string): string => {
  if (url.includes('alchemy')) return 'alchemy';
  if (url.includes('gateway.tenderly.co')) return 'tenderly';
  let envName: string | undefined;
  try {
    envName = getNetworkEnv(chainId as SupportedChainIds);
    if (envName && process.env[envName] === url) return `env ${envName}`;
  } catch {
    /* chain not in toolbox list */
  }
  return 'public/fallback';
};

/**
 * Resolve the *primary* RPC URL for a chain (toolbox → Alchemy → env override). Backwards-
 * compatible with callers that need a single URL (e.g. `eth_getProof` direct fetch in the
 * storage-roots flow).
 */
export const getRpcUrl = (chainId: number): string => {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const url = toolboxGetRpcUrl(chainId as SupportedChainIds, {alchemyKey});
  if (url) return url;

  // Prefer Tenderly Gateway over viem's public-default URL — public RPCs are typically
  // rate-limited and apply tight `eth_getLogs` block-range caps that break wide scans.
  const tenderly = tenderlyGatewayUrl(chainId);
  if (tenderly) return tenderly;

  const chain = viemChainByChainId(chainId);
  const publicUrl = chain?.rpcUrls.default.http[0];
  if (publicUrl) return publicUrl;

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

/**
 * Build the ordered list of candidate RPC URLs for a chain. De-duplicated; preserves order
 * (primary first, user-specified backups, public fallbacks last).
 *
 * Env-driven overrides — operator-specified URLs always win over toolbox/public defaults:
 *   - `RPC_<NETWORK>` may be a single URL or a **comma-separated list** of URLs (first =
 *     primary, the rest are tried in order on failure).
 *   - The same `<NETWORK>` slug used by `@aave-dao/toolbox` (e.g. `RPC_MAINNET`,
 *     `RPC_POLYGON`) and the chain.name-derived slug are both checked.
 */
const candidateUrls = (chainId: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string | undefined | null) => {
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const addList = (raw: string | undefined | null) => {
    if (!raw) return;
    for (const u of raw.split(',')) add(u);
  };

  const chain = viemChainByChainId(chainId);
  const envNames = new Set<string>();
  try {
    envNames.add(getNetworkEnv(chainId as SupportedChainIds));
  } catch {
    /* chain not in toolbox list */
  }
  if (chain) {
    envNames.add(`RPC_${chain.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`);
  }
  // 1. Operator-specified URLs from RPC_<NAME> (comma-separated supported).
  for (const name of envNames) addList(process.env[name]);

  // 2. Toolbox-resolved URL (Alchemy via ALCHEMY_API_KEY, or toolbox's own fallback table).
  //    Skipped when the env override above is present, because toolbox also reads RPC_<NAME>
  //    and would just duplicate it.
  if (out.length === 0) {
    try {
      const alchemyKey = process.env.ALCHEMY_API_KEY;
      add(toolboxGetRpcUrl(chainId as SupportedChainIds, {alchemyKey}) as string | undefined);
    } catch {
      /* chain not in toolbox list */
    }
  }

  // 3. Tenderly Gateway — supports wide `eth_getLogs` ranges where viem's public defaults
  //    cap at a couple-thousand blocks. Always added (if a slug exists for this chain) so a
  //    transient Alchemy hiccup doesn't drop straight onto a rate-limited public node.
  add(tenderlyGatewayUrl(chainId));

  // 4. Viem public RPCs as last-resort backups.
  if (chain) {
    for (const u of chain.rpcUrls.default.http) add(u);
  }

  return out;
};

const buildTransport = (chainId: number): Transport => {
  const urls = candidateUrls(chainId);
  if (urls.length === 0) {
    throw new Error(`No RPC available for chainId=${chainId}`);
  }
  const transports: HttpTransport[] = urls.map((u) =>
    http(u, {
      timeout: HTTP_TIMEOUT_MS,
      retryCount: PER_TRANSPORT_RETRIES,
    }),
  );
  if (transports.length === 1) return transports[0]!;
  return fallback(transports, {
    rank: false,
    retryCount: FALLBACK_RETRY_COUNT,
  });
};

const synthChain = (chainId: number, primaryUrl: string): Chain =>
  ({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
    rpcUrls: {default: {http: [primaryUrl]}},
  } as Chain);

export const getPublicClient = (chainId: number): PublicClient => {
  const hit = publicCache.get(chainId);
  if (hit) return hit;
  const chain = viemChainByChainId(chainId) ?? synthChain(chainId, getRpcUrl(chainId));
  const transport = buildTransport(chainId);
  const client = createPublicClient({chain, transport}) as unknown as PublicClient;
  publicCache.set(chainId, client);
  return client;
};

export const getWalletClient = (chainId: number, privateKey: Hex): WalletClient => {
  const account = privateKeyToAccount(privateKey);
  const key = `${chainId}:${account.address.toLowerCase()}`;
  const hit = walletCache.get(key);
  if (hit) return hit;

  const chain = viemChainByChainId(chainId) ?? synthChain(chainId, getRpcUrl(chainId));
  const transport = buildTransport(chainId);
  const client = createWalletClient({
    account,
    chain,
    transport,
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
