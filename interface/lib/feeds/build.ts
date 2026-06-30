// Caching layer. Each chain's scan is wrapped in unstable_cache keyed by chainId and tagged
// `feeds:chain:<id>` + `feeds:all`, so the expensive multicall sweep runs at most once per
// revalidate window (or until a tag is busted by the refresh route). The cross-chain asset
// model is *composed* from these per-chain caches rather than separately cached — that keeps
// each cache entry small and means a per-chain refresh transparently updates the asset views.

import 'server-only';
import { unstable_cache } from 'next/cache';
import { buildChainGraph, closureFrom } from './graph';
import { CHAIN_IDS } from './markets';
import {
  chainTag,
  TAG_FEEDS_ALL,
  type AssetModelEntry,
  type ChainFeedGraph,
  type FeedWithNodes,
} from './types';

/** Backstop TTL (24h). The daily feed-refresh cron (api/cron/feed-refresh) and the manual
 *  Refresh button are the primary freshness mechanisms via revalidateTag; this just ensures
 *  nothing is served stale beyond a day if the cron is ever skipped and no one refreshes. */
const REVALIDATE_SECONDS = 60 * 60 * 24;

/** Cached single-chain topology. */
export const getChainGraph = (chainId: number): Promise<ChainFeedGraph> =>
  unstable_cache(() => buildChainGraph(chainId), ['feeds-chain', String(chainId)], {
    tags: [chainTag(chainId), TAG_FEEDS_ALL],
    revalidate: REVALIDATE_SECONDS,
  })();

/** Every chain we can scan, in parallel, skipping any that error (bad RPC, etc.). */
export async function getAllChainGraphs(): Promise<ChainFeedGraph[]> {
  const settled = await Promise.allSettled(CHAIN_IDS.map((id) => getChainGraph(id)));
  return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
}

/** Cross-chain, per-symbol model. Reuses the cached per-chain graphs and attaches each
 *  feed's self-contained node closure so the asset page can render trees without the
 *  chain-wide node map. */
export async function getAssetModel(): Promise<AssetModelEntry[]> {
  const graphs = await getAllChainGraphs();
  const bySymbol = new Map<string, AssetModelEntry>();
  for (const g of graphs) {
    for (const asset of g.assets) {
      const entry = bySymbol.get(asset.symbol) ?? { symbol: asset.symbol, chains: [] };
      const feeds: FeedWithNodes[] = asset.feeds.map((f) => ({
        ...f,
        nodes: closureFrom(g.nodes, f.leaf),
      }));
      entry.chains.push({ chainId: g.chainId, chainName: g.name, feeds });
      bySymbol.set(asset.symbol, entry);
    }
  }
  const out = [...bySymbol.values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol, undefined, { sensitivity: 'base' }),
  );
  for (const e of out) e.chains.sort((a, b) => a.chainId - b.chainId);
  return out;
}

/** One symbol's cross-chain story (case-insensitive match), or null if not listed anywhere. */
export async function getAssetEntry(symbol: string): Promise<AssetModelEntry | null> {
  const target = symbol.toLowerCase();
  const model = await getAssetModel();
  return model.find((e) => e.symbol.toLowerCase() === target) ?? null;
}
