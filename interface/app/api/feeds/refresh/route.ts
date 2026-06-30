// Operator-triggered cache invalidation for the price-feed views. Busts the unstable_cache
// tags so the next render re-scans on chain. Mirrors the open (no-auth) convention of
// app/api/proposals/[id]/refresh.
//
//   POST /api/feeds/refresh           → revalidate every chain (feeds:all)
//   POST /api/feeds/refresh?chain=1   → revalidate just chain 1
//
// Returns 200 with the tag(s) revalidated, 400 for an unknown chain id.

import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { CHAIN_IDS } from '@/lib/feeds/markets';
import { chainTag, TAG_FEEDS_ALL } from '@/lib/feeds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const chainParam = req.nextUrl.searchParams.get('chain');

  if (chainParam) {
    const chainId = Number(chainParam);
    if (!Number.isInteger(chainId) || !CHAIN_IDS.includes(chainId)) {
      return NextResponse.json({ ok: false, error: `unknown chain ${chainParam}` }, { status: 400 });
    }
    const tag = chainTag(chainId);
    revalidateTag(tag);
    return NextResponse.json({ ok: true, revalidated: [tag] });
  }

  revalidateTag(TAG_FEEDS_ALL);
  return NextResponse.json({ ok: true, revalidated: [TAG_FEEDS_ALL] });
}
