import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { executions, payloads, proposals } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';
import { ProposalDetail } from '@/components/ProposalDetail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProposalDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  let proposalId: bigint;
  try {
    proposalId = BigInt(id);
  } catch {
    notFound();
  }

  const [proposal] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  if (!proposal) {
    return (
      <main>
        <p className="empty">
          Proposal #{id} not yet cached. The cache-refresh cron populates the latest 20 proposals
          every minute. If this id is older than that, it isn&apos;t in the cache.
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

  return (
    <main>
      <ProposalDetail
        initialProposal={jsonSafe(proposal) as React.ComponentProps<typeof ProposalDetail>['initialProposal']}
        initialPayloads={jsonSafe(proposalPayloads) as React.ComponentProps<typeof ProposalDetail>['initialPayloads']}
        initialExecutions={jsonSafe(recentExecutions) as React.ComponentProps<typeof ProposalDetail>['initialExecutions']}
      />
    </main>
  );
}
