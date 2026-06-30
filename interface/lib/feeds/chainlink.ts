// Chainlink Reference Data Directory (RDD) enrichment.
//
// The public RDD publishes per-network feed config — deviation threshold + heartbeat — at
// https://reference-data-directory.vercel.app/feeds-<network>.json. We fetch the file for a
// chain and index it by both proxy and aggregator address so a discovered ChainlinkFeed node
// can be annotated with its official update parameters (and, combined with the on-chain
// latestTimestamp, whether it's overdue for an update).

/** Official feed config for a single Chainlink aggregator. */
export type ClFeedMeta = {
  name?: string;
  /** Max seconds between updates Chainlink guarantees (the "heartbeat"). 0/undefined = none. */
  heartbeatSec?: number;
  /** Deviation threshold in percent that triggers an off-heartbeat update (e.g. 0.5 = 0.5%). */
  deviationPct?: number;
  /** RDD risk/SLA tier: low | medium | high | custom | new | deprecating. */
  feedCategory?: string;
};

// our chainId → RDD network slug (every slug confirmed live against the directory, with feed
// counts). Only Metis (1088) has no RDD file published, so it's the lone chain that skips
// enrichment.
const RDD_SLUG: Record<number, string> = {
  1: 'mainnet',
  10: 'ethereum-mainnet-optimism-1',
  56: 'bsc-mainnet',
  100: 'xdai-mainnet',
  137: 'matic-mainnet',
  143: 'monad-mainnet',
  146: 'sonic-mainnet',
  5000: 'ethereum-mainnet-mantle-1',
  8453: 'ethereum-mainnet-base-1',
  9745: 'plasma-mainnet',
  42161: 'ethereum-mainnet-arbitrum-1',
  42220: 'celo-mainnet',
  43114: 'avalanche-mainnet',
  59144: 'ethereum-mainnet-linea-1',
  534352: 'ethereum-mainnet-scroll-1',
};

type RddEntry = {
  proxyAddress?: string;
  contractAddress?: string;
  name?: string;
  heartbeat?: number | string;
  threshold?: number;
  feedCategory?: string;
};

const RDD_TIMEOUT_MS = 10_000;
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

const toHeartbeat = (h: unknown): number | undefined => {
  const n = typeof h === 'string' ? Number(h) : typeof h === 'number' ? h : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Fetch + index the RDD for a chain. Keyed by lowercased proxy AND aggregator address so a
 * lookup matches whichever the adapter points at. Returns an empty map for unsupported chains
 * or on any fetch/parse error (enrichment is best-effort and never fails a scan).
 */
export async function getChainlinkIndex(chainId: number): Promise<Map<string, ClFeedMeta>> {
  const idx = new Map<string, ClFeedMeta>();
  const slug = RDD_SLUG[chainId];
  if (!slug) return idx;

  let entries: RddEntry[];
  try {
    const res = await fetch(`https://reference-data-directory.vercel.app/feeds-${slug}.json`, {
      signal: AbortSignal.timeout(RDD_TIMEOUT_MS),
    });
    if (!res.ok) return idx;
    entries = (await res.json()) as RddEntry[];
  } catch {
    return idx;
  }
  if (!Array.isArray(entries)) return idx;

  for (const e of entries) {
    const meta: ClFeedMeta = {
      name: e.name,
      heartbeatSec: toHeartbeat(e.heartbeat),
      deviationPct: typeof e.threshold === 'number' ? e.threshold : undefined,
      feedCategory: e.feedCategory,
    };
    for (const a of [e.proxyAddress, e.contractAddress]) {
      if (isAddr(a)) idx.set(a.toLowerCase(), meta);
    }
  }
  return idx;
}
