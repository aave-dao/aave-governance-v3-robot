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
import { displayStateName } from '@/lib/display-state';
import { nextActionLabel, pickVoteSource } from '@/lib/eta';
import { fmtAbsolute } from '@/lib/format';
import { VoteBar, thresholdWei } from './VoteBar';
import { VoterList, type VoteRow } from './VoterList';
import { AddressLink } from './AddressLink';

type ProposalShape = {
  id: string;
  state: number;
  stateName: string;
  creator: string;
  creationTime: number;
  votingActivationTime: number;
  queuingTime: number;
  votingDuration: number;
  cooldownPeriod: number;
  coolDownBeforeVotingStart: number;
  forVotes: string | null;
  againstVotes: string | null;
  vmForVotes: string | null;
  vmAgainstVotes: string | null;
  vmStateName: string | null;
  yesThreshold: string | null;
  yesNoDifferential: string | null;
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
  raw: {
    createdAt: number | null;
    queuedAt: number | null;
    executedAt: number | null;
    cancelledAt: number | null;
    expirationTime: number | null;
    delay: number | null;
    gracePeriod: number | null;
    executionActions: Array<{
      target: string;
      withDelegateCall: boolean;
      accessLevel: number;
      value: string;
      signature: string;
      callData: string;
    }>;
  } | null;
};

type Props = {
  initialProposal: ProposalShape;
  initialPayloads: PayloadShape[];
  initialExecutions: ExecutionRow[];
  initialVotes: VoteRow[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const fmtTs = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return fmtAbsolute(Math.floor(d.getTime() / 1000));
};

export function ProposalDetail({
  initialProposal,
  initialPayloads,
  initialExecutions,
  initialVotes,
}: Props) {
  const { data } = useSWR<{
    proposal: ProposalShape;
    payloads: PayloadShape[];
    recentExecutions: ExecutionRow[];
    votes: VoteRow[];
  }>(`/api/proposals/${initialProposal.id}`, fetcher, {
    fallbackData: {
      proposal: initialProposal,
      payloads: initialPayloads,
      recentExecutions: initialExecutions,
      votes: initialVotes,
    },
    refreshInterval: 15_000,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const proposal = data?.proposal ?? initialProposal;
  const payloads = data?.payloads ?? initialPayloads;
  const executions = data?.recentExecutions ?? initialExecutions;
  const proposalVotes = data?.votes ?? initialVotes;
  const elig = proposal.eligibility;
  const next = nextActionLabel(proposal);
  const votes = pickVoteSource(proposal);
  const thresholds = {
    yesThresholdWei: thresholdWei(proposal.yesThreshold),
    yesNoDifferentialWei: thresholdWei(proposal.yesNoDifferential),
  };

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
            <StateBadge
              state={displayStateName(proposal.state, proposal.stateName, elig.payloads)}
            />
          </div>
          <div className="dim mono" style={{ marginTop: 4 }}>
            {proposal.metadata?.title ?? '(no metadata yet)'}
          </div>
          <div className={`tone-${next.tone} mono`} style={{ marginTop: 8, fontSize: 13 }} suppressHydrationWarning>
            {next.label}
          </div>
        </div>
        <div style={{ textAlign: 'right' }} className="mono dim" suppressHydrationWarning>
          refreshed {fmtTs(proposal.refreshedAt)}
        </div>
      </header>

      <section className="section">
        <h2>Votes</h2>
        <div className="card">
          <VoteBar snapshot={votes} variant="full" thresholds={thresholds} />
        </div>
      </section>

      <section className="section">
        <h2>Voters {proposalVotes.length > 0 ? `(${proposalVotes.length})` : ''}</h2>
        <VoterList votes={proposalVotes} />
      </section>

      <section className="section">
        <h2>Overview</h2>
        <div className="card">
          <div className="kv-grid">
            <div className="k">creator</div>
            <div className="v">
              <AddressLink address={proposal.creator} chainId={1} full />
            </div>
            <div className="k">voting portal</div>
            <div className="v">
              <AddressLink address={proposal.votingPortal} chainId={1} full />
            </div>
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

