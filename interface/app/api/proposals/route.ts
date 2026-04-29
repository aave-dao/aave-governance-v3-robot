import { NextResponse, type NextRequest } from 'next/server';
import { desc, lt } from 'drizzle-orm';
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

  const rows = cursor === null
    ? await db.select().from(proposals).orderBy(desc(proposals.id)).limit(limit + 1)
    : await db
        .select()
        .from(proposals)
        .where(lt(proposals.id, cursor))
        .orderBy(desc(proposals.id))
        .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id.toString() : null;

  return NextResponse.json(
    { proposals: jsonSafe(page), nextCursor },
    { headers: { 'cache-control': 'no-store' } },
  );
}
