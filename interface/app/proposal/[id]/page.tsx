import { notFound } from 'next/navigation';
import { jsonSafe } from '@/lib/serialize';
import { displayStateName } from '@/lib/display-state';
import { loadProposalDetail } from '@/lib/proposal-detail';
import { inspectAndCacheProposal } from '@/lib/refresh';
import { ProposalDetail } from '@/components/ProposalDetail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

/** Re-inspect on visit when the cached row is older than this AND the proposal isn't in a
 *  terminal state. Catches the #486-style failure where the cron silently dropped a single
 *  proposal — the row otherwise stays frozen until the next manual intervention. */
const STALE_MS = 5 * 60 * 1000;

/** Terminal proposal states — these don't change on-chain, so no point re-inspecting. */
const isFinalState = (
  state: number,
  stateName: string,
  payloads: { stateNumber: number }[] | undefined,
): boolean => {
  // Failed / Cancelled / Expired — never change.
  if (state === 5 || state === 6 || state === 7) return true;
  // Executed AND all payloads terminal → "Completed" per displayStateName.
  if (state === 4) {
    return displayStateName(state, stateName, payloads as never) !== 'Executing';
  }
  return false;
};

export default async function ProposalDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  let proposalId: bigint;
  try {
    proposalId = BigInt(id);
  } catch {
    notFound();
  }

  let bundle = await loadProposalDetail(proposalId);
  if (!bundle) {
    try {
      await inspectAndCacheProposal(proposalId);
      bundle = await loadProposalDetail(proposalId);
    } catch (err) {
      return (
        <main>
          <p className="text-fg-muted text-sm italic">
            Proposal #{id} could not be loaded:{' '}
            <span className="font-mono">{err instanceof Error ? err.message : String(err)}</span>
          </p>
        </main>
      );
    }
  } else {
    // Two self-heal paths from a cached-but-incomplete row:
    //   (a) empty-payloads pathology from the pre-0006 (chain_id, payload_id) unique key
    //   (b) stale refreshedAt on a non-final proposal — the cron silently dropped this one
    //       (see #486 incident: inspectProposal threw, Promise.allSettled swallowed it,
    //       UI rendered day-old data forever)
    const ageMs = Date.now() - new Date(bundle.proposal.refreshedAt).getTime();
    const hasEmptyPayloadsPathology =
      bundle.payloads.length === 0 &&
      Array.isArray((bundle.proposal.raw as { payloads?: unknown[] } | null)?.payloads) &&
      ((bundle.proposal.raw as { payloads: unknown[] }).payloads.length ?? 0) > 0;
    const isStaleAndLive =
      ageMs > STALE_MS &&
      !isFinalState(
        bundle.proposal.state,
        bundle.proposal.stateName,
        bundle.proposal.eligibility?.payloads,
      );
    if (hasEmptyPayloadsPathology || isStaleAndLive) {
      try {
        await inspectAndCacheProposal(proposalId);
        bundle = (await loadProposalDetail(proposalId)) ?? bundle;
      } catch {
        // best-effort — fall through with the stale bundle so the rest of the page still
        // renders. The recordProposalError path in runCacheRefresh would normally surface
        // the failure, but inspectAndCacheProposal doesn't go through that — so the next
        // cron tick is what populates last_error for the operator to see.
      }
    }
  }
  if (!bundle) {
    return (
      <main>
        <p className="text-fg-muted text-sm italic">Proposal #{id} not found on-chain.</p>
      </main>
    );
  }

  return (
    <ProposalDetail
      initialProposal={jsonSafe(bundle.proposal) as React.ComponentProps<typeof ProposalDetail>['initialProposal']}
      initialPayloads={jsonSafe(bundle.payloads) as React.ComponentProps<typeof ProposalDetail>['initialPayloads']}
      initialExecutions={jsonSafe(bundle.executions) as React.ComponentProps<typeof ProposalDetail>['initialExecutions']}
      initialVotes={jsonSafe(bundle.votes) as React.ComponentProps<typeof ProposalDetail>['initialVotes']}
      initialEns={bundle.ens}
      initialLifecycleTxs={bundle.lifecycleTxs}
    />
  );
}
