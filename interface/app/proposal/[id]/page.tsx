import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { executions, payloads, proposals, votes } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';
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

  let [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  // Lazy backfill: SSR pulls the proposal in via the inspector if the cache is missing it.
  if (!proposal) {
    try {
      await inspectAndCacheProposal(proposalId);
      [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
    } catch (err) {
      return (
        <main>
          <p className="empty">
            Proposal #{id} could not be loaded:{' '}
            <span className="mono">{err instanceof Error ? err.message : String(err)}</span>
          </p>
        </main>
      );
    }
  }
  if (!proposal) {
    return (
      <main>
        <p className="empty">
          Proposal #{id} not found on-chain.
        </p>
      </main>
    );
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

  const proposalVotes = await db
    .select()
    .from(votes)
    .where(eq(votes.proposalId, proposalId))
    .orderBy(asc(votes.blockNumber), asc(votes.logIndex));

  return (
    <main>
      <ProposalDetail
        initialProposal={jsonSafe(proposal) as React.ComponentProps<typeof ProposalDetail>['initialProposal']}
        initialPayloads={jsonSafe(proposalPayloads) as React.ComponentProps<typeof ProposalDetail>['initialPayloads']}
        initialExecutions={jsonSafe(recentExecutions) as React.ComponentProps<typeof ProposalDetail>['initialExecutions']}
        initialVotes={jsonSafe(proposalVotes) as React.ComponentProps<typeof ProposalDetail>['initialVotes']}
      />
    </main>
  );
}
