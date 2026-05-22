// Paginated list endpoint with optional `q` (search) and `state` (filter) params.
// Filtering runs server-side so the client doesn't have to load every proposal just to
// search across them.
//
//   GET /api/proposals?cursor=N&limit=20&q=stETH&state=Active,Queued
//
// Response includes `total` (overall row count) and `matching` (rows matching the current
// filter) on the FIRST page only — pagination after that doesn't repeat the COUNT.

import { NextResponse, type NextRequest } from 'next/server';
import { and, count, desc, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { proposals } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const q = (url.searchParams.get('q') ?? '').trim();
  const stateParam = url.searchParams.get('state') ?? '';
  const states = stateParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let limit = limitParam ? Math.max(1, Number(limitParam)) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  let cursor: bigint | null = null;
  if (cursorParam) {
    try {
      cursor = BigInt(cursorParam);
    } catch {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
    }
  }

  const conds: SQL[] = [];
  if (cursor !== null) conds.push(lt(proposals.id, cursor));
  if (q) {
    // Search across id (substring), creator (case-insensitive), and metadata.title.
    // `metadata->>'title'` returns text from the JSONB column; COALESCE handles null
    // metadata blobs (proposals whose IPFS fetch hasn't succeeded yet).
    const like = `%${q.toLowerCase()}%`;
    conds.push(sql`(
      ${proposals.id}::text LIKE ${`%${q}%`}
      OR LOWER(${proposals.creator}) LIKE ${like}
      OR LOWER(COALESCE(${proposals.metadata}->>'title', '')) LIKE ${like}
    )`);
  }
  if (states.length > 0) {
    conds.push(inArray(proposals.displayState, states));
  }
  // `and()` with one arg returns that arg; with zero we just pass undefined.
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(proposals)
    .where(where)
    .orderBy(desc(proposals.id))
    .limit(limit + 1);

  // Include row counts on the first page only — these are stable across pagination of the
  // same query, so repeating the COUNTs every page would just be wasted DB work.
  let total: number | undefined;
  let matching: number | undefined;
  if (cursor === null) {
    const totalRow = await db.select({ c: count() }).from(proposals);
    total = Number(totalRow[0]?.c ?? 0);
    if (q || states.length > 0) {
      const matchingRow = await db.select({ c: count() }).from(proposals).where(where);
      matching = Number(matchingRow[0]?.c ?? 0);
    } else {
      matching = total;
    }
  }

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id.toString() : null;

  return NextResponse.json(
    { proposals: jsonSafe(page), nextCursor, total, matching },
    { headers: { 'cache-control': 'no-store' } },
  );
}
