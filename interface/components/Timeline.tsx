'use client';

import { fmtAbsolute, fmtRelative } from '@/lib/format';
import type { EligibilityBlob } from '@/db/schema';

type Proposal = {
  state: number;
  stateName: string;
  creationTime: number;
  votingActivationTime: number;
  queuingTime: number;
  eligibility: EligibilityBlob;
};

// ProposalState: Null=0, Created=1, Active=2, Queued=3, Executed=4, Failed=5, Cancelled=6, Expired=7.
const STAGES = [
  { key: 'created', label: 'Created', minState: 1 },
  { key: 'active', label: 'Active (voting)', minState: 2 },
  { key: 'queued', label: 'Queued', minState: 3 },
  { key: 'executed', label: 'Executed', minState: 4 },
] as const;

type Stage = typeof STAGES[number];

const stageState = (proposal: Proposal, stage: Stage): 'done' | 'current' | 'upcoming' => {
  if (proposal.state >= 5) {
    // Cancelled / Failed / Expired — show what's done so far based on actual timestamps.
    return 'upcoming';
  }
  if (proposal.state > stage.minState) return 'done';
  if (proposal.state === stage.minState) return 'current';
  return 'upcoming';
};

const stageEta = (proposal: Proposal, stage: Stage): string | null => {
  const elig = proposal.eligibility;
  if (stage.key === 'created') {
    return proposal.creationTime > 0 ? fmtAbsolute(proposal.creationTime) : null;
  }
  if (stage.key === 'active') {
    if (proposal.votingActivationTime > 0) return fmtAbsolute(proposal.votingActivationTime);
    if (elig.activate.etaAt) return `${fmtAbsolute(elig.activate.etaAt)} (${fmtRelative(elig.activate.etaAt)})`;
    return null;
  }
  if (stage.key === 'queued') {
    if (proposal.queuingTime > 0) return fmtAbsolute(proposal.queuingTime);
    if (elig.voting?.closeAndSendVote.etaAt) {
      return `voting ends ${fmtRelative(elig.voting.closeAndSendVote.etaAt)}`;
    }
    return null;
  }
  if (stage.key === 'executed') {
    if (elig.execute.etaAt) {
      return `${fmtAbsolute(elig.execute.etaAt)} (${fmtRelative(elig.execute.etaAt)})`;
    }
    return null;
  }
  return null;
};

export function Timeline({ proposal }: { proposal: Proposal }) {
  const isFinalAbnormal = proposal.state >= 5;
  return (
    <div className="timeline">
      {STAGES.map((s) => {
        const status = stageState(proposal, s);
        const eta = stageEta(proposal, s);
        return (
          <div key={s.key} className="timeline-step">
            <div className={`timeline-dot ${status === 'upcoming' ? '' : status}`} />
            <div className="label">{s.label}</div>
            <div className="eta">{eta ?? '—'}</div>
          </div>
        );
      })}
      {isFinalAbnormal && (
        <div className="timeline-step">
          <div className="timeline-dot" style={{ background: 'var(--red)' }} />
          <div className="label">{proposal.stateName}</div>
          <div className="eta">terminal</div>
        </div>
      )}
    </div>
  );
}
