import { NextResponse, type NextRequest } from 'next/server';
import { jsonSafe } from '@/lib/serialize';
import { loadProposalDetail } from '@/lib/proposal-detail';
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

  // Lazy backfill: any proposal id can be looked up, even if the cache-refresh cron hasn't
  // touched it yet. `?refresh=1` re-inspects an already-cached proposal (useful right after
  // sending a tx).
  const wantsRefresh = new URL(req.url).searchParams.get('refresh') === '1';
  let bundle = await loadProposalDetail(proposalId);
  if (!bundle || wantsRefresh) {
    try {
      await inspectAndCacheProposal(proposalId);
      bundle = await loadProposalDetail(proposalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `inspect failed: ${message}` }, { status: 500 });
    }
  }
  if (!bundle) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(
    {
      proposal: jsonSafe(bundle.proposal),
      payloads: jsonSafe(bundle.payloads),
      recentExecutions: jsonSafe(bundle.executions),
      votes: jsonSafe(bundle.votes),
      ens: bundle.ens,
      lifecycleTxs: bundle.lifecycleTxs,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
