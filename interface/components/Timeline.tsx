'use client';

import { Check, Circle, Clock, AlertTriangle } from 'lucide-react';
import { fmtAbsolute, fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import type { EligibilityBlob } from '@/db/schema';
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

type Step = {
  key: string;
  label: string;
  status: 'done' | 'current' | 'upcoming' | 'terminal';
  at?: number;
  eta?: number;
  predicted?: boolean;
};

const buildL1Steps = (p: Proposal): Step[] => {
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
    label: 'Active (voting)',
    status: p.state > 2 ? 'done' : p.state === 2 ? 'current' : 'upcoming',
    at: activeAt,
    eta: activeEta,
    predicted: activePredicted,
  });

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
  });

  return steps;
};

const buildPayloadSteps = (p: Proposal): Step[] =>
  p.eligibility.payloads.map((pl): Step => {
    const settled = PAYLOAD_TERMINAL[pl.stateNumber] === true;
    return {
      key: `payload-${pl.chainId}-${pl.payloadId}`,
      label: `Payload #${pl.payloadId} · ${pl.chainName} (${pl.state})`,
      status: settled ? 'done' : pl.executable.eligible ? 'current' : 'upcoming',
      eta: settled ? undefined : pl.executable.etaAt,
    };
  });

export function Timeline({ proposal }: { proposal: Proposal }) {
  const isFinalAbnormal = proposal.state >= 5;
  const l1Steps = buildL1Steps(proposal);
  const payloadSteps = buildPayloadSteps(proposal);
  const allSteps: Step[] = [
    ...l1Steps,
    ...(isFinalAbnormal
      ? [
          {
            key: 'terminal',
            label: proposal.stateName,
            status: 'terminal' as const,
            at: proposal.creationTime,
          },
        ]
      : []),
    ...payloadSteps,
  ];

  // Sync the live clock cadence to the next pending step.
  const nextEvent = allSteps.find((s) => s.status === 'current')?.eta
    ?? allSteps.find((s) => s.status === 'upcoming')?.eta
    ?? null;
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

  return (
    <li className="flex items-start gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center self-stretch">
        <span className={dotClasses}>
          <Icon size={11} strokeWidth={2.5} />
        </span>
        {!isLast && <span className="mt-0 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 -mt-px pt-0.5">
        <div
          className={cn(
            'text-[13px] font-medium leading-snug',
            step.status === 'upcoming' ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {step.label}
        </div>
        <div className="font-mono text-[11px] text-fg-dim" suppressHydrationWarning>
          {time}
        </div>
      </div>
    </li>
  );
}
