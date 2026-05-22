// Operator-triggered manual refresh for a single proposal. Same code path as the cron's
// per-proposal inspection — just on-demand instead of scheduled.
//
//   POST /api/proposals/142/refresh
//
// Returns 200 with `{ok: true, refreshedAt}` on success, 500 with `{ok: false, error}` on
// inspector failure. The proposal's `last_error` / `last_error_at` columns will already be
// set by `inspectAndCacheProposal`'s failure path (which records + re-throws), so a failed
// retry shows up in the UI immediately on next render.

import { NextResponse, type NextRequest } from 'next/server';
import { inspectAndCacheProposal } from '@/lib/refresh';
import { formatError } from '@/lib/format-error';
import { getLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid proposal id' }, { status: 400 });
  }

  let proposalId: bigint;
  try {
    proposalId = BigInt(id);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid proposal id' }, { status: 400 });
  }

  try {
    await inspectAndCacheProposal(proposalId);
    return NextResponse.json({ ok: true, refreshedAt: new Date().toISOString() });
  } catch (err) {
    const message = formatError(err);
    getLogger().warn('manual refresh: failed', { proposalId: id, error: message });
    // Don't re-fire notifyError here — inspectAndCacheProposal's own failure path already
    // records last_error AND calls notifyError with dedupe. Double-notifying would just
    // bump the suppressed-count rather than alerting twice, but we still avoid the work.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
