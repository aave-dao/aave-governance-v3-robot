'use client';

import { Check, Circle, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { fmtAbsolute, fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { txExplorerUrl } from '@/lib/explorer-client';
import type { EligibilityBlob } from '@/db/schema';
import type { LifecycleTxs, TxRef } from '@/lib/lifecycle-txs';
import { GOVERNANCE_CHAIN_ID } from '@robot/core/chains';
import { cn } from './ui/cn';

type Proposal = {
  state: number;
  stateName: string;
  creationTime: number;
  votingActivationTime: number;
  queuingTime: number;
  votingDuration: number;
  cooldownPeriod: number;
  coolDownBeforeVotingStart: number;
  eligibility: EligibilityBlob;
};

const PAYLOAD_TERMINAL: Record<number, true> = { 3: true, 4: true, 5: true };

type StepLink = { chainId: number; tx: TxRef };

type Step = {
  key: string;
  label: string;
  status: 'done' | 'current' | 'upcoming' | 'terminal';
  at?: number;
  eta?: number;
  predicted?: boolean;
  /** Optional explorer link for the on-chain event that effected this stage. */
  link?: StepLink;
};

const buildL1Steps = (p: Proposal, txs: LifecycleTxs): Step[] => {
  const elig = p.eligibility;
  const steps: Step[] = [];
  const createdAt = p.creationTime > 0 ? p.creationTime : undefined;
  steps.push({
    key: 'created',
    label: 'Created',
    status: p.state >= 1 ? 'done' : 'upcoming',
    at: createdAt,
  });

  const activeAt = p.votingActivationTime > 0 ? p.votingActivationTime : undefined;
  let activeEta: number | undefined;
  let activePredicted = false;
  if (!activeAt) {
    if (elig.activate.etaAt) activeEta = elig.activate.etaAt;
    else if (createdAt && p.coolDownBeforeVotingStart > 0) {
      activeEta = createdAt + p.coolDownBeforeVotingStart;
      activePredicted = true;
    }
  }
  steps.push({
    key: 'active',
    label: 'Activated on L1',
    status: p.state > 2 ? 'done' : p.state === 2 ? 'current' : 'upcoming',
    at: activeAt,
    eta: activeEta,
    predicted: activePredicted,
    link: txs.votingActivated
      ? { chainId: GOVERNANCE_CHAIN_ID, tx: txs.votingActivated }
      : undefined,
  });

  // L2 voting hops: only render when we have a voting chain configured.
  const vmChainId = txs.votingChainId ?? elig.voting?.chainId;
  if (vmChainId !== undefined) {
    if (txs.votingBridged) {
      steps.push({
        key: 'voting-bridged',
        label: `Vote config bridged → ${elig.voting?.chainName ?? `chain ${vmChainId}`}`,
        status: 'done',
        link: { chainId: vmChainId, tx: txs.votingBridged },
      });
    }
    if (txs.storageRootsSubmitted) {
      steps.push({
        key: 'storage-roots',
        label: 'Storage roots registered',
        status: 'done',
        link: { chainId: vmChainId, tx: txs.storageRootsSubmitted },
      });
    }
    if (txs.voteStarted) {
      steps.push({
        key: 'vote-started',
        label: 'Vote started on L2',
        status: 'done',
        link: { chainId: vmChainId, tx: txs.voteStarted },
      });
    }
    if (txs.resultsSent) {
      steps.push({
        key: 'results-sent',
        label: 'Vote closed → results sent to L1',
        status: 'done',
        link: { chainId: vmChainId, tx: txs.resultsSent },
      });
    }
  }

  const queuedAt = p.queuingTime > 0 ? p.queuingTime : undefined;
  let queuedEta: number | undefined;
  let queuedPredicted = false;
  if (!queuedAt) {
    if (elig.voting?.closeAndSendVote.etaAt) {
      queuedEta = elig.voting.closeAndSendVote.etaAt;
    } else if (activeAt && p.votingDuration > 0) {
      queuedEta = activeAt + p.votingDuration;
      queuedPredicted = true;
    } else if (activeEta && p.votingDuration > 0) {
      queuedEta = activeEta + p.votingDuration;
      queuedPredicted = true;
    }
  }
  steps.push({
    key: 'queued',
    label: 'Queued',
    status: p.state > 3 ? 'done' : p.state === 3 ? 'current' : 'upcoming',
    at: queuedAt,
    eta: queuedEta,
    predicted: queuedPredicted,
    link: txs.queued ? { chainId: GOVERNANCE_CHAIN_ID, tx: txs.queued } : undefined,
  });

  let executedEta: number | undefined;
  let executedPredicted = false;
  if (p.state < 4) {
    if (elig.execute.etaAt) executedEta = elig.execute.etaAt;
    else if (queuedEta && p.cooldownPeriod > 0) {
      executedEta = queuedEta + p.cooldownPeriod;
      executedPredicted = true;
    }
  }
  steps.push({
    key: 'executed',
    label: 'L1 executed',
    status:
      p.state >= 4 && p.state < 5
        ? 'done'
        : p.state >= 5
          ? 'terminal'
          : p.state === 3
            ? 'current'
            : 'upcoming',
    eta: executedEta,
    predicted: executedPredicted,
    link: txs.executed
      ? { chainId: GOVERNANCE_CHAIN_ID, tx: txs.executed }
      : txs.cancelled
        ? { chainId: GOVERNANCE_CHAIN_ID, tx: txs.cancelled }
        : undefined,
  });

  return steps;
};

const buildPayloadSteps = (p: Proposal, txs: LifecycleTxs): Step[] => {
  const out: Step[] = [];
  for (const pl of p.eligibility.payloads) {
    const settled = PAYLOAD_TERMINAL[pl.stateNumber] === true;
    const queuedTx = txs.payloadQueued[`${pl.chainId}-${pl.payloadId}`];
    const executedTx = txs.payloadExecuted[`${pl.chainId}-${pl.payloadId}`];
    // Header step — primary line in the list, summarising state + linking to the executed tx
    // when present (since that's the most actionable hash for an executed payload).
    out.push({
      key: `payload-${pl.chainId}-${pl.payloadId}`,
      label: `Payload #${pl.payloadId} · ${pl.chainName} (${pl.state})`,
      status: settled ? 'done' : pl.executable.eligible ? 'current' : 'upcoming',
      eta: settled ? undefined : pl.executable.etaAt,
      link: executedTx
        ? { chainId: pl.chainId, tx: executedTx }
        : queuedTx
          ? { chainId: pl.chainId, tx: queuedTx }
          : undefined,
    });
    // Sub-steps for the cross-chain hops on the payload's chain. Only emitted when we
    // actually found the events — keeps unfinished payloads from getting noisy.
    if (queuedTx) {
      out.push({
        key: `payload-queued-${pl.chainId}-${pl.payloadId}`,
        label: `↳ Queued (cross-chain msg received)`,
        status: 'done',
        link: { chainId: pl.chainId, tx: queuedTx },
      });
    }
    if (executedTx) {
      out.push({
        key: `payload-executed-${pl.chainId}-${pl.payloadId}`,
        label: `↳ Executed`,
        status: 'done',
        link: { chainId: pl.chainId, tx: executedTx },
      });
    }
  }
  return out;
};

export function Timeline({
  proposal,
  lifecycleTxs,
}: {
  proposal: Proposal;
  lifecycleTxs?: LifecycleTxs;
}) {
  const txs: LifecycleTxs = lifecycleTxs ?? { payloadQueued: {}, payloadExecuted: {} };
  const isFinalAbnormal = proposal.state >= 5;
  const l1Steps = buildL1Steps(proposal, txs);
  const payloadSteps = buildPayloadSteps(proposal, txs);
  const allSteps: Step[] = [
    ...l1Steps,
    ...(isFinalAbnormal
      ? [
          {
            key: 'terminal',
            label: proposal.stateName,
            status: 'terminal' as const,
            at: proposal.creationTime,
            link: txs.cancelled
              ? { chainId: GOVERNANCE_CHAIN_ID, tx: txs.cancelled }
              : undefined,
          },
        ]
      : []),
    ...payloadSteps,
  ];

  // Sync the live clock cadence to the next pending step.
  const nextEvent =
    allSteps.find((s) => s.status === 'current')?.eta ??
    allSteps.find((s) => s.status === 'upcoming')?.eta ??
    null;
  const now = useNow(nextEvent);

  return (
    <ol className="relative flex flex-col gap-0">
      {allSteps.map((s, i) => (
        <TimelineStep
          key={s.key}
          step={s}
          isLast={i === allSteps.length - 1}
          now={now}
        />
      ))}
    </ol>
  );
}

function TimelineStep({
  step,
  isLast,
  now,
}: {
  step: Step;
  isLast: boolean;
  now: number;
}) {
  const dotClasses = cn(
    'relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border',
    step.status === 'done' && 'border-success bg-success-bg text-success',
    step.status === 'current' && 'border-accent bg-accent-bg text-accent',
    step.status === 'upcoming' && 'border-border bg-surface text-fg-dim',
    step.status === 'terminal' && 'border-danger bg-danger-bg text-danger',
  );
  const Icon =
    step.status === 'done'
      ? Check
      : step.status === 'terminal'
        ? AlertTriangle
        : step.status === 'current'
          ? Clock
          : Circle;
  const time = step.at
    ? fmtAbsolute(step.at)
    : step.eta
      ? `${step.predicted ? '~' : ''}${fmtAbsolute(step.eta)} (${fmtRelative(step.eta, now)})`
      : step.status === 'done'
        ? 'completed'
        : step.status === 'terminal'
          ? 'terminal'
          : '—';

  const txUrl = step.link ? txExplorerUrl(step.link.chainId, step.link.tx.txHash) : null;

  return (
    <li className="flex items-start gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center self-stretch">
        <span className={dotClasses}>
          <Icon size={11} strokeWidth={2.5} />
        </span>
        {!isLast && <span className="mt-0 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 -mt-px pt-0.5">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'text-[13px] font-medium leading-snug',
              step.status === 'upcoming' ? 'text-fg-muted' : 'text-fg',
            )}
          >
            {step.label}
          </div>
          {step.link && (
            <a
              href={txUrl ?? '#'}
              target={txUrl ? '_blank' : undefined}
              rel={txUrl ? 'noreferrer' : undefined}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface-elev px-1.5 py-px font-mono text-[10px] text-fg-muted hover:border-accent-border hover:text-accent transition-colors"
              title={`View tx ${step.link.tx.txHash}`}
            >
              tx
              <ExternalLink size={9} strokeWidth={2.25} className="opacity-70" />
            </a>
          )}
        </div>
        <div className="font-mono text-[11px] text-fg-dim" suppressHydrationWarning>
          {time}
        </div>
      </div>
    </li>
  );
}
