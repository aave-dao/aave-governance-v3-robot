'use client';

import { fmtAbsolute, fmtRelative } from '@/lib/format';
import type { EligibilityBlob } from '@/db/schema';

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

// ProposalState: Null=0, Created=1, Active=2, Queued=3, Executed=4, Failed=5, Cancelled=6, Expired=7
// PayloadState:  None=0,  Created=1, Queued=2, Executed=3, Cancelled=4, Expired=5
const PAYLOAD_TERMINAL: Record<number, true> = { 3: true, 4: true, 5: true };

type Step = {
  key: string;
  label: string;
  status: 'done' | 'current' | 'upcoming' | 'terminal';
  /** Concrete past timestamp, or "—". */
  at?: number;
  /** Estimated future timestamp; chained from earlier stages when not yet known. */
  eta?: number;
  /** Marker that the eta was chained (predicted) rather than read from chain state. */
  predicted?: boolean;
};

const buildL1Steps = (p: Proposal): Step[] => {
  const elig = p.eligibility;
  const steps: Step[] = [];

  // Created
  const createdAt = p.creationTime > 0 ? p.creationTime : undefined;
  steps.push({
    key: 'created',
    label: 'Created',
    status: p.state >= 1 ? 'done' : 'upcoming',
    at: createdAt,
  });

  // Active
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

  // Queued — voting ends → forVotes counted → cross-chain results land here.
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

  // Executed (L1)
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
    label: 'L1 executed (cross-chain msg sent)',
    status: p.state >= 4 && p.state < 5 ? 'done' : p.state >= 5 ? 'terminal' : p.state === 3 ? 'current' : 'upcoming',
    eta: executedEta,
    predicted: executedPredicted,
  });

  return steps;
};

const buildPayloadSteps = (p: Proposal): Step[] => {
  return p.eligibility.payloads.map((pl): Step => {
    const settled = PAYLOAD_TERMINAL[pl.stateNumber] === true;
    return {
      key: `payload-${pl.chainId}-${pl.payloadId}`,
      label: `Payload #${pl.payloadId} on ${pl.chainName} (${pl.state})`,
      status: settled ? 'done' : pl.executable.eligible ? 'current' : 'upcoming',
      eta: settled ? undefined : pl.executable.etaAt,
    };
  });
};

const formatTime = (s: Step): string => {
  if (s.at) return fmtAbsolute(s.at);
  if (s.eta) {
    const prefix = s.predicted ? '~' : '';
    return `${prefix}${fmtAbsolute(s.eta)} (${fmtRelative(s.eta)})`;
  }
  if (s.status === 'done') return 'completed';
  if (s.status === 'terminal') return 'terminal';
  return '—';
};

export function Timeline({ proposal }: { proposal: Proposal }) {
  const isFinalAbnormal = proposal.state >= 5;
  const l1Steps = buildL1Steps(proposal);
  const payloadSteps = buildPayloadSteps(proposal);

  return (
    <div className="timeline">
      {l1Steps.map((s) => (
        <div key={s.key} className="timeline-step">
          <div
            className={`timeline-dot ${
              s.status === 'done' ? 'done' : s.status === 'current' ? 'current' : ''
            }`}
            style={s.status === 'terminal' ? { background: 'var(--red)' } : undefined}
          />
          <div className="label">{s.label}</div>
          <div className="eta" suppressHydrationWarning>
            {formatTime(s)}
          </div>
        </div>
      ))}
      {isFinalAbnormal && (
        <div className="timeline-step">
          <div className="timeline-dot" style={{ background: 'var(--red)' }} />
          <div className="label">{proposal.stateName}</div>
          <div className="eta">terminal</div>
        </div>
      )}
      {payloadSteps.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0', paddingTop: 8 }}>
          {payloadSteps.map((s) => (
            <div key={s.key} className="timeline-step">
              <div
                className={`timeline-dot ${
                  s.status === 'done' ? 'done' : s.status === 'current' ? 'current' : ''
                }`}
              />
              <div className="label">{s.label}</div>
              <div className="eta" suppressHydrationWarning>
                {formatTime(s)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
