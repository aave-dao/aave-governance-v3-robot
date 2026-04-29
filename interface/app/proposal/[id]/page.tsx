import { notFound } from 'next/navigation';
import { jsonSafe } from '@/lib/serialize';
import { loadProposalDetail } from '@/lib/proposal-detail';
import { inspectAndCacheProposal } from '@/lib/refresh';
import { ProposalDetail } from '@/components/ProposalDetail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

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
    />
  );
}
