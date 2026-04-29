import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { executions, payloads, proposals } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let proposalId: bigint;
  try {
    proposalId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const proposalPayloads = await db
    .select()
    .from(payloads)
    .where(eq(payloads.proposalId, proposalId));

  const recentExecutions = await db
    .select()
    .from(executions)
    .where(eq(executions.proposalId, proposalId))
    .orderBy(desc(executions.createdAt))
    .limit(10);

  return NextResponse.json(
    {
      proposal: jsonSafe(proposal),
      payloads: jsonSafe(proposalPayloads),
      recentExecutions: jsonSafe(recentExecutions),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
