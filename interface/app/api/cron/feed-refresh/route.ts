// Daily price-feed cache refresh.
//
// Feed topology (CAPO adapters, caps, snapshots, Chainlink sources) changes rarely, so the
// per-chain scans are cached aggressively (see lib/feeds/build.ts) and refreshed once a day
// here instead of on a visitor's request. The cron:
//   1. busts the feed cache tags — this invalidates BOTH the unstable_cache data entries AND
//      the ISR pages that read them (pages inherit the tags of the caches they consume), so
//      the next visit re-renders with fresh data;
//   2. re-scans + re-caches every chain so that next render is a cheap cache hit, not a
//      cold multi-chain sweep.
//
// Bad RPC on a chain is skipped (getAllChainGraphs uses allSettled), never failing the cron.

import { revalidateTag } from 'next/cache';
import { getAllChainGraphs, getAssetModel } from '@/lib/feeds/build';
import { CHAIN_IDS } from '@/lib/feeds/markets';
import { notifyDueFeeds } from '@/lib/feeds/notify-due';
import { chainTag, TAG_FEEDS_ALL } from '@/lib/feeds/types';
import { wrapCron } from '@/lib/cron-handler';
import { getLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = wrapCron('feed-refresh', async () => {
  // 1. Invalidate cached graphs + the pages that depend on them.
  revalidateTag(TAG_FEEDS_ALL);
  for (const id of CHAIN_IDS) revalidateTag(chainTag(id));

  // 2. Warm: recompute every per-chain graph (fresh on-chain scan, re-stored under its tag).
  const graphs = await getAllChainGraphs();
  // 3. Warm the cross-chain asset model from the now-fresh per-chain caches (no extra RPC).
  const model = await getAssetModel();

  // 4. Alert if any Chainlink leaf is overdue past its heartbeat.
  const { dueCount } = await notifyDueFeeds(graphs, getLogger());

  const failed = CHAIN_IDS.filter((id) => !graphs.some((g) => g.chainId === id));
  return {
    chainsRefreshed: graphs.length,
    chainsTotal: CHAIN_IDS.length,
    chainsFailed: failed,
    assets: model.length,
    nodes: graphs.reduce((n, g) => n + g.nodes.length, 0),
    feedsDue: dueCount,
  };
});
