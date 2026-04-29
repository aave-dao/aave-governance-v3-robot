'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  Zap,
  Check,
  X as XIcon,
  ExternalLink,
  Copy,
  Hash,
} from 'lucide-react';
import useSWR from 'swr';
import { ipfsHashToCidV0 } from '@robot/core/ipfs';
import { displayStateName } from '@/lib/display-state';
import { nextActionLabel, pickVoteSource, type NextAction } from '@/lib/eta';
import { fmtAbsolute, fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import type {
  EligibilityBlob,
  NextRecommendedBlob,
  ProposalMetadataBlob,
} from '@/db/schema';
import { Card, CardBody, CardHeader, CardTitle } from './ui/Card';
import { useToast } from './ui/Toast';
import { StateBadge } from './StateBadge';
import { Timeline } from './Timeline';
import { ActionButton } from './ActionButton';
import { PayloadCard } from './PayloadCard';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ExecutionRow } from './ExecutionList';
import { VoteBar, thresholdWei } from './VoteBar';
import { VoterList, type VoteRow } from './VoterList';
import { AddressLink } from './AddressLink';
import { cn } from './ui/cn';

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
  initialEns?: Record<string, string | null>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TONE_BG: Record<NextAction['tone'], string> = {
  pending: 'bg-accent',
  ready: 'bg-success',
  final: 'bg-fg-dim',
  failed: 'bg-danger',
};
const TONE_TEXT: Record<NextAction['tone'], string> = {
  pending: 'text-accent',
  ready: 'text-success',
  final: 'text-fg-muted',
  failed: 'text-danger',
};
const TONE_ICON: Record<NextAction['tone'], React.ReactNode> = {
  pending: <Clock size={12} strokeWidth={2.5} />,
  ready: <Zap size={12} strokeWidth={2.5} />,
  final: <Check size={12} strokeWidth={2.5} />,
  failed: <XIcon size={12} strokeWidth={2.5} />,
};

export function ProposalDetail({
  initialProposal,
  initialPayloads,
  initialExecutions,
  initialVotes,
  initialEns,
}: Props) {
  const toast = useToast();

  const { data } = useSWR<{
    proposal: ProposalShape;
    payloads: PayloadShape[];
    recentExecutions: ExecutionRow[];
    votes: VoteRow[];
    ens: Record<string, string | null>;
  }>(`/api/proposals/${initialProposal.id}`, fetcher, {
    fallbackData: {
      proposal: initialProposal,
      payloads: initialPayloads,
      recentExecutions: initialExecutions,
      votes: initialVotes,
      ens: initialEns ?? {},
    },
    refreshInterval: 15_000,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const proposal = data?.proposal ?? initialProposal;
  const payloads = data?.payloads ?? initialPayloads;
  const proposalVotes = data?.votes ?? initialVotes;
  const ens = data?.ens ?? initialEns ?? {};
  const elig = proposal.eligibility;
  const votes = pickVoteSource(proposal);
  const thresholds = {
    yesThresholdWei: thresholdWei(proposal.yesThreshold),
    yesNoDifferentialWei: thresholdWei(proposal.yesNoDifferential),
  };
  const next = nextActionLabel(proposal); // initial server compute
  const now = useNow(next.nextEventAt ?? null);
  const liveNext = nextActionLabel(proposal, now);
  const display = displayStateName(proposal.state, proposal.stateName, elig.payloads);

  const ipfsLink = (() => {
    try {
      return `https://cloudflare-ipfs.com/ipfs/${ipfsHashToCidV0(proposal.ipfsHash as `0x${string}`)}`;
    } catch {
      return null;
    }
  })();

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.info(`${label} copied`);
    } catch {
      toast.error('Copy failed');
    }
  };

  const creatorEns = ens[proposal.creator.toLowerCase()];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted transition-colors hover:text-fg w-fit"
      >
        <ArrowLeft size={12} strokeWidth={2.25} />
        All proposals
      </Link>

      {/* Hero */}
      <div className="relative rounded-xl border border-border bg-surface px-5 py-5 sm:px-7 sm:py-6 overflow-hidden">
        <span
          className={cn('absolute left-0 top-6 bottom-6 w-[3px] rounded-r-full', TONE_BG[liveNext.tone])}
          aria-hidden
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] sm:text-[14px] tabular-nums text-fg-dim">
                #{proposal.id}
              </span>
              <StateBadge state={display} />
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium font-mono',
                  liveNext.tone === 'pending' && 'border-accent-border bg-accent-bg',
                  liveNext.tone === 'ready' && 'border-success-border bg-success-bg',
                  liveNext.tone === 'final' && 'border-border bg-surface-elev',
                  liveNext.tone === 'failed' && 'border-danger-border bg-danger-bg',
                  TONE_TEXT[liveNext.tone],
                )}
                suppressHydrationWarning
              >
                {TONE_ICON[liveNext.tone]}
                {liveNext.label}
              </span>
            </div>
            <h1 className="text-[19px] sm:text-[24px] font-semibold tracking-tight leading-tight">
              {proposal.metadata?.title ?? (
                <span className="italic text-fg-dim">(no metadata yet)</span>
              )}
            </h1>
            <div className="flex items-center gap-2 text-[12px] text-fg-muted flex-wrap">
              <span className="text-fg-dim">by</span>
              <AddressLink
                address={proposal.creator}
                chainId={1}
                ensName={creatorEns}
                showIcon
              />
              <span className="text-fg-dim">·</span>
              <span className="font-mono" suppressHydrationWarning>
                created {fmtRelative(proposal.creationTime, now)}
              </span>
            </div>
          </div>
          <div
            className="text-[11px] font-mono text-fg-dim sm:text-right whitespace-nowrap"
            suppressHydrationWarning
          >
            refreshed {fmtAbsolute(Math.floor(new Date(proposal.refreshedAt).getTime() / 1000))}
          </div>
        </div>
      </div>

      {/* Two-column layout: sidebar above main on mobile, side-by-side on lg+. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6 min-w-0 order-2 lg:order-1">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-4 text-[12px]">
                <dt className="text-fg-dim">creator</dt>
                <dd>
                  <AddressLink
                    address={proposal.creator}
                    chainId={1}
                    ensName={creatorEns}
                    full={!creatorEns}
                    showIcon
                  />
                </dd>
                <dt className="text-fg-dim">voting portal</dt>
                <dd>
                  <AddressLink
                    address={proposal.votingPortal}
                    chainId={1}
                    full
                    showIcon
                  />
                </dd>
                <dt className="text-fg-dim">snapshot</dt>
                <dd className="font-mono break-all text-fg flex items-center gap-1.5">
                  {proposal.snapshotBlockHash}
                  <button
                    type="button"
                    onClick={() => copyText('Block hash', proposal.snapshotBlockHash)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-surface-elev hover:text-fg"
                    aria-label="Copy"
                  >
                    <Copy size={11} strokeWidth={2.25} />
                  </button>
                </dd>
                <dt className="text-fg-dim">ipfs</dt>
                <dd className="font-mono break-all text-fg flex items-center gap-1.5">
                  {proposal.ipfsHash}
                  {ipfsLink && (
                    <a
                      href={ipfsLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-surface-elev hover:text-fg"
                      aria-label="Open on IPFS gateway"
                    >
                      <ExternalLink size={11} strokeWidth={2.25} />
                    </a>
                  )}
                </dd>
                {proposal.metadata?.author && (
                  <>
                    <dt className="text-fg-dim">author</dt>
                    <dd className="text-fg">{proposal.metadata.author}</dd>
                  </>
                )}
                {proposal.metadata?.discussions && (
                  <>
                    <dt className="text-fg-dim">discussions</dt>
                    <dd>
                      <a
                        href={proposal.metadata.discussions}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:text-accent-strong inline-flex items-center gap-1"
                      >
                        Forum thread
                        <ExternalLink size={10} strokeWidth={2.25} className="opacity-60" />
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>

          {/* Payloads */}
          <Section title="Payloads" count={payloads.length}>
            {payloads.length === 0 ? (
              <EmptyMini>No payloads.</EmptyMini>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {payloads.map((p) => (
                  <PayloadCard key={`${p.chainId}-${p.payloadId}`} payload={p} />
                ))}
              </div>
            )}
          </Section>

          {/* Voters */}
          <Section title="Voters" count={proposalVotes.length}>
            <VoterList votes={proposalVotes} ens={ens} />
          </Section>

          {/* Body */}
          {proposal.metadata?.body && (
            <Section title="Proposal body">
              <Card className="p-4 sm:p-6">
                <MarkdownRenderer source={proposal.metadata.body} />
              </Card>
            </Section>
          )}
          {proposal.metadataError && (
            <Section title="Metadata error">
              <Card className="px-5 py-4 text-[12px] font-mono text-danger">
                {proposal.metadataError}
              </Card>
            </Section>
          )}
        </div>

        {/* Sticky sidebar (above main on mobile, sticky right on lg+). */}
        <aside className="space-y-4 order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          {/* Status / next action */}
          <Card>
            <CardHeader>
              <CardTitle eyebrow="status">Next action</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium font-mono',
                  liveNext.tone === 'pending' && 'border-accent-border bg-accent-bg text-accent',
                  liveNext.tone === 'ready' && 'border-success-border bg-success-bg text-success',
                  liveNext.tone === 'final' && 'border-border bg-surface-elev text-fg-muted',
                  liveNext.tone === 'failed' && 'border-danger-border bg-danger-bg text-danger',
                )}
                suppressHydrationWarning
              >
                {TONE_ICON[liveNext.tone]}
                {liveNext.label}
              </div>
              <div className="space-y-2">
                <PrimaryActions proposal={proposal} eligibility={elig} />
              </div>
            </CardBody>
          </Card>

          {/* Votes */}
          <Card>
            <CardHeader>
              <CardTitle eyebrow="tally">Votes</CardTitle>
            </CardHeader>
            <CardBody>
              <VoteBar snapshot={votes} variant="full" thresholds={thresholds} />
            </CardBody>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle eyebrow="lifecycle">Timeline</CardTitle>
            </CardHeader>
            <CardBody>
              <Timeline proposal={proposal} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function PrimaryActions({
  proposal,
  eligibility,
}: {
  proposal: ProposalShape;
  eligibility: EligibilityBlob;
}) {
  const elig = eligibility;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <ActionButton
          action="activateVoting"
          id={proposal.id}
          chainId={1}
          eligibility={elig.activate}
          variant="governance"
        />
        <ActionButton
          action="executeProposal"
          id={proposal.id}
          chainId={1}
          eligibility={elig.execute}
          variant="governance"
        />
        <ActionButton
          action="cancelProposal"
          id={proposal.id}
          chainId={1}
          eligibility={elig.cancel}
          variant="cancel"
        />
      </div>
      {elig.voting && (
        <>
          <div className="pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-dim">
            Voting · {elig.voting.chainName}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ActionButton
              action="submitStorageRoots"
              id={proposal.id}
              chainId={elig.voting.chainId}
              eligibility={elig.voting.submitStorageRoots}
              variant="voting"
            />
            <ActionButton
              action="createVote"
              id={proposal.id}
              chainId={elig.voting.chainId}
              eligibility={elig.voting.createVote}
              variant="voting"
            />
            <ActionButton
              action="closeAndSendVote"
              id={proposal.id}
              chainId={elig.voting.chainId}
              eligibility={elig.voting.closeAndSendVote}
              variant="voting"
            />
          </div>
        </>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-fg-dim">
          {title}
        </h2>
        {count !== undefined && (
          <span className="font-mono text-[11px] text-fg-dim tabular-nums">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyMini({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-6 text-center text-[12px] text-fg-dim italic">
      {children}
    </div>
  );
}

void Hash; // reserved for future ipfs decoration
