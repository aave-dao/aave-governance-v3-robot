import { NextResponse, type NextRequest } from 'next/server';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { executions, payloads, proposals, votes } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';
import { inspectAndCacheProposal } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let proposalId: bigint;
  try {
    proposalId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  // Lazy backfill: any proposal id can be looked up, even if the cache-refresh cron hasn't
  // touched it yet. Inspector takes ~2s for a Queued proposal, ~5-10s when payloads span many
  // chains; the route's maxDuration covers that. `?refresh=1` re-inspects an already-cached
  // proposal (useful right after sending a tx).
  const wantsRefresh = new URL(req.url).searchParams.get('refresh') === '1';
  if (!proposal || wantsRefresh) {
    try {
      await inspectAndCacheProposal(proposalId);
      [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `inspect failed: ${message}` }, { status: 500 });
    }
  }
  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

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

  const proposalVotes = await db
    .select()
    .from(votes)
    .where(eq(votes.proposalId, proposalId))
    .orderBy(asc(votes.blockNumber), asc(votes.logIndex));

  return NextResponse.json(
    {
      proposal: jsonSafe(proposal),
      payloads: jsonSafe(proposalPayloads),
      recentExecutions: jsonSafe(recentExecutions),
      votes: jsonSafe(proposalVotes),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
