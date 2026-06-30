// Operator-triggered refresh for the price-feed views. Busts the unstable_cache tags (which
// also purges the ISR pages that read them), re-scans on chain to warm the cache, and alerts
// if any Chainlink leaf is overdue. Mirrors the open (no-auth) convention of
// app/api/proposals/[id]/refresh.
//
//   POST /api/feeds/refresh           → refresh every chain (feeds:all)
//   POST /api/feeds/refresh?chain=1   → refresh just chain 1
//
// Returns 200 with the tag(s) revalidated + the due-feed count, 400 for an unknown chain id.

import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { getAllChainGraphs, getChainGraph } from '@/lib/feeds/build';
import { CHAIN_IDS } from '@/lib/feeds/markets';
import { notifyDueFeeds } from '@/lib/feeds/notify-due';
import { chainTag, TAG_FEEDS_ALL } from '@/lib/feeds/types';
import { getLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const chainParam = req.nextUrl.searchParams.get('chain');
  const logger = getLogger();

  if (chainParam) {
    const chainId = Number(chainParam);
    if (!Number.isInteger(chainId) || !CHAIN_IDS.includes(chainId)) {
      return NextResponse.json({ ok: false, error: `unknown chain ${chainParam}` }, { status: 400 });
    }
    const tag = chainTag(chainId);
    revalidateTag(tag);
    // Recompute now (tag busted) so the next render is a cache hit and we can check staleness.
    const graph = await getChainGraph(chainId);
    const { dueCount } = await notifyDueFeeds([graph], logger);
    return NextResponse.json({ ok: true, revalidated: [tag], feedsDue: dueCount });
  }

  revalidateTag(TAG_FEEDS_ALL);
  const graphs = await getAllChainGraphs();
  const { dueCount } = await notifyDueFeeds(graphs, logger);
  return NextResponse.json({ ok: true, revalidated: [TAG_FEEDS_ALL], feedsDue: dueCount });
}
