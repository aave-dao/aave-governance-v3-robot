'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { StateBadge } from './StateBadge';
import { Timeline } from './Timeline';
import { ActionButton } from './ActionButton';
import { PayloadCard } from './PayloadCard';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ExecutionList, type ExecutionRow } from './ExecutionList';
import type {
  EligibilityBlob,
  NextRecommendedBlob,
  ProposalMetadataBlob,
} from '@/db/schema';
import { ipfsHashToCidV0 } from '@robot/core/ipfs';

type ProposalShape = {
  id: string;
  state: number;
  stateName: string;
  creator: string;
  creationTime: number;
  votingActivationTime: number;
  queuingTime: number;
  ipfsHash: string;
  votingPortal: string;
  snapshotBlockHash: string;
  metadata: ProposalMetadataBlob | null;
  metadataError: string | null;
  eligibility: EligibilityBlob;
  nextRecommended: NextRecommendedBlob | null;
  raw: unknown;
  refreshedAt: string;
  updatedAt: string;
};

type PayloadShape = {
  chainId: number;
  payloadId: number;
  proposalId: string;
  chainName: string;
  payloadsController: string;
  state: number;
  stateName: string;
  actionCount: number;
  executable: { eligible: boolean; reason?: string; etaAt?: number };
};

type Props = {
  initialProposal: ProposalShape;
  initialPayloads: PayloadShape[];
  initialExecutions: ExecutionRow[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ProposalDetail({ initialProposal, initialPayloads, initialExecutions }: Props) {
  const { data } = useSWR<{
    proposal: ProposalShape;
    payloads: PayloadShape[];
    recentExecutions: ExecutionRow[];
  }>(`/api/proposals/${initialProposal.id}`, fetcher, {
    fallbackData: {
      proposal: initialProposal,
      payloads: initialPayloads,
      recentExecutions: initialExecutions,
    },
    refreshInterval: 15_000,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const proposal = data?.proposal ?? initialProposal;
  const payloads = data?.payloads ?? initialPayloads;
  const executions = data?.recentExecutions ?? initialExecutions;
  const elig = proposal.eligibility;

  const ipfsLink = (() => {
    try {
      return `https://cloudflare-ipfs.com/ipfs/${ipfsHashToCidV0(proposal.ipfsHash as `0x${string}`)}`;
    } catch {
      return null;
    }
  })();

  return (
    <>
      <header className="app-header">
        <div>
          <Link href="/" className="dim">← all proposals</Link>
          <div style={{ marginTop: 8 }} className="bigid">
            #{proposal.id}{' '}
            <StateBadge state={proposal.stateName} />
          </div>
          <div className="dim mono" style={{ marginTop: 4 }}>
            {proposal.metadata?.title ?? '(no metadata yet)'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }} className="mono dim">
          refreshed {new Date(proposal.refreshedAt).toISOString().slice(0, 19).replace('T', ' ')} UTC
        </div>
      </header>

      <section className="section">
        <h2>Overview</h2>
        <div className="card">
          <div className="kv-grid">
            <div className="k">creator</div>
            <div className="v">{proposal.creator}</div>
            <div className="k">voting portal</div>
            <div className="v">{proposal.votingPortal}</div>
            <div className="k">snapshot block</div>
            <div className="v">{proposal.snapshotBlockHash}</div>
            <div className="k">ipfs hash</div>
            <div className="v">
              {proposal.ipfsHash}
              {ipfsLink && (
                <>
                  {' '}
                  · <a href={ipfsLink} target="_blank" rel="noreferrer">view on gateway</a>
                </>
              )}
            </div>
            {proposal.metadata?.author && (
              <>
                <div className="k">author</div>
                <div className="v">{proposal.metadata.author}</div>
              </>
            )}
            {proposal.metadata?.discussions && (
              <>
                <div className="k">discussions</div>
                <div className="v">
                  <a href={proposal.metadata.discussions} target="_blank" rel="noreferrer">
                    {proposal.metadata.discussions}
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Timeline</h2>
        <div className="card">
          <Timeline proposal={proposal} />
        </div>
      </section>

      <section className="section">
        <h2>Governance actions</h2>
        <div className="card">
          <div className="action-row">
            <ActionButton
              action="activateVoting"
              id={proposal.id}
              chainId={1}
              eligibility={elig.activate}
            />
            <ActionButton
              action="executeProposal"
              id={proposal.id}
              chainId={1}
              eligibility={elig.execute}
            />
            <ActionButton
              action="cancelProposal"
              id={proposal.id}
              chainId={1}
              eligibility={elig.cancel}
              destructive
            />
          </div>
        </div>
      </section>

      {elig.voting && (
        <section className="section">
          <h2>
            Voting · <span className="dim mono">{elig.voting.chainName} (chainId {elig.voting.chainId})</span>{' '}
            <StateBadge state={elig.voting.state} />
          </h2>
          <div className="card">
            <div className="action-row">
              <ActionButton
                action="submitStorageRoots"
                id={proposal.id}
                chainId={elig.voting.chainId}
                eligibility={elig.voting.submitStorageRoots}
              />
              <ActionButton
                action="createVote"
                id={proposal.id}
                chainId={elig.voting.chainId}
                eligibility={elig.voting.createVote}
              />
              <ActionButton
                action="closeAndSendVote"
                id={proposal.id}
                chainId={elig.voting.chainId}
                eligibility={elig.voting.closeAndSendVote}
              />
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Payloads</h2>
        {payloads.length === 0 ? (
          <p className="empty">No payloads.</p>
        ) : (
          <div className="payload-grid">
            {payloads.map((p) => (
              <PayloadCard key={`${p.chainId}-${p.payloadId}`} payload={p} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Recent executions</h2>
        <ExecutionList executions={executions} />
      </section>

      {proposal.metadata?.body && (
        <section className="section">
          <h2>Proposal body</h2>
          <MarkdownRenderer source={proposal.metadata.body} />
        </section>
      )}
      {proposal.metadataError && (
        <section className="section">
          <h2>Metadata error</h2>
          <div className="card mono dim">{proposal.metadataError}</div>
        </section>
      )}
    </>
  );
}

