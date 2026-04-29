import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { proposals } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await db.select().from(proposals).orderBy(desc(proposals.id)).limit(20);
  return NextResponse.json(
    { proposals: jsonSafe(rows) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
