import type { EligibilityBlob } from '@/db/schema';
import { fmtDate, fmtRelative } from './format';

// ProposalState: Null=0, Created=1, Active=2, Queued=3, Executed=4, Failed=5, Cancelled=6, Expired=7
// VotingMachineProposalState: NotCreated=0, Active=1, Finished=2, SentToGovernance=3
// PayloadState: None=0, Created=1, Queued=2, Executed=3, Cancelled=4, Expired=5

const PAYLOAD_TERMINAL: Record<number, true> = { 3: true, 4: true, 5: true };

export type NextAction = {
  /** Single-line human-readable label for the row. */
  label: string;
  /** Tone used by the UI to color the label. */
  tone: 'pending' | 'ready' | 'final' | 'failed';
  /** Unix-seconds timestamp of the next event (so callers can drive a live countdown). */
  nextEventAt?: number;
};

type ProposalForEta = {
  state: number;
  stateName: string;
  creationTime: number;
  eligibility: EligibilityBlob;
};

const rel = (etaAt: number, now?: number) => fmtRelative(etaAt, now);

const earliestPayloadEta = (payloads: EligibilityBlob['payloads']): number | undefined => {
  let best: number | undefined;
  for (const p of payloads) {
    if (PAYLOAD_TERMINAL[p.stateNumber]) continue;
    const eta = p.executable.etaAt;
    if (eta === undefined) continue;
    if (best === undefined || eta < best) best = eta;
  }
  return best;
};

const allPayloadsTerminal = (payloads: EligibilityBlob['payloads']): boolean =>
  payloads.length > 0 && payloads.every((p) => PAYLOAD_TERMINAL[p.stateNumber] === true);

const anyPayloadReady = (payloads: EligibilityBlob['payloads']): boolean =>
  payloads.some((p) => p.executable.eligible);

export const nextActionLabel = (p: ProposalForEta, now?: number): NextAction => {
  const elig = p.eligibility;
  const vmState = elig.voting?.stateNumber;

  // Terminal failure states
  if (p.state === 5) return { label: `Failed · ${fmtDate(p.creationTime)}`, tone: 'failed' };
  if (p.state === 6) return { label: `Cancelled · ${fmtDate(p.creationTime)}`, tone: 'failed' };
  if (p.state === 7) return { label: `Expired · ${fmtDate(p.creationTime)}`, tone: 'failed' };

  // Created — waiting for cooldown to activate voting
  if (p.state === 1) {
    if (elig.activate.eligible) return { label: 'Ready to activate voting', tone: 'ready' };
    if (elig.activate.etaAt) {
      return {
        label: `Voting starts ${rel(elig.activate.etaAt, now)}`,
        tone: 'pending',
        nextEventAt: elig.activate.etaAt,
      };
    }
    return { label: 'Awaiting cooldown', tone: 'pending' };
  }

  // Active — voting is in progress on L2
  if (p.state === 2) {
    if (vmState === 1) {
      // Active on L2
      if (elig.voting?.closeAndSendVote.etaAt) {
        return {
          label: `Voting ends ${rel(elig.voting.closeAndSendVote.etaAt, now)}`,
          tone: 'pending',
          nextEventAt: elig.voting.closeAndSendVote.etaAt,
        };
      }
      return { label: 'Voting in progress', tone: 'pending' };
    }
    if (vmState === 2) return { label: 'Ready to close vote', tone: 'ready' };
    if (vmState === 3) return { label: 'Awaiting L1 queueing', tone: 'pending' };
    if (elig.voting?.createVote.eligible) {
      return { label: 'Ready to start vote', tone: 'ready' };
    }
    if (elig.voting?.submitStorageRoots.eligible) {
      return { label: 'Ready to submit roots', tone: 'ready' };
    }
    return { label: 'Voting setup pending', tone: 'pending' };
  }

  // Queued — waiting for cooldown to execute on L1
  if (p.state === 3) {
    if (elig.execute.eligible) return { label: 'Ready to execute on L1', tone: 'ready' };
    if (elig.execute.etaAt) {
      return {
        label: `L1 executes ${rel(elig.execute.etaAt, now)}`,
        tone: 'pending',
        nextEventAt: elig.execute.etaAt,
      };
    }
    return { label: 'Awaiting L1 cooldown', tone: 'pending' };
  }

  // Executed (L1) — payloads still need to run on each chain
  if (p.state === 4) {
    if (allPayloadsTerminal(elig.payloads)) {
      return { label: `Completed · ${fmtDate(p.creationTime)}`, tone: 'final' };
    }
    if (anyPayloadReady(elig.payloads)) {
      return { label: 'Payloads ready to execute', tone: 'ready' };
    }
    const earliest = earliestPayloadEta(elig.payloads);
    if (earliest !== undefined) {
      return {
        label: `Payloads execute ${rel(earliest, now)}`,
        tone: 'pending',
        nextEventAt: earliest,
      };
    }
    return { label: 'Payloads queueing', tone: 'pending' };
  }

  return { label: p.stateName, tone: 'pending' };
};

// ─── Vote source picker ────────────────────────────────────────────────────────

export type VoteSnapshot = {
  forVotes: bigint;
  againstVotes: bigint;
  /** 'l1' once queueProposal has run; 'vm' for live tally; null when neither is meaningful. */
  source: 'l1' | 'vm' | null;
  /** Free-form caption, e.g. "L1 final" or "Live · Polygon · Active". */
  caption: string;
};

type ProposalForVotes = {
  state: number;
  forVotes: string | null;
  againstVotes: string | null;
  vmForVotes: string | null;
  vmAgainstVotes: string | null;
  vmStateName: string | null;
  eligibility: EligibilityBlob;
};

const toBig = (s: string | null): bigint => {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
};

export const pickVoteSource = (p: ProposalForVotes): VoteSnapshot => {
  // Once L1 has finalized the tally (state >= Queued and forVotes populated), prefer it.
  if (p.state >= 3 && (p.forVotes || p.againstVotes)) {
    return {
      forVotes: toBig(p.forVotes),
      againstVotes: toBig(p.againstVotes),
      source: 'l1',
      caption: 'L1 final',
    };
  }
  // Otherwise, if a voting chain has a running tally (any non-zero), surface it.
  const hasVm =
    (p.vmForVotes && toBig(p.vmForVotes) > 0n) ||
    (p.vmAgainstVotes && toBig(p.vmAgainstVotes) > 0n);
  if (hasVm) {
    const chain = p.eligibility.voting?.chainName ?? 'voting chain';
    const stateLabel = p.vmStateName ?? p.eligibility.voting?.state ?? 'unknown';
    return {
      forVotes: toBig(p.vmForVotes),
      againstVotes: toBig(p.vmAgainstVotes),
      source: 'vm',
      caption: `Live · ${chain} · ${stateLabel}`,
    };
  }
  return {
    forVotes: 0n,
    againstVotes: 0n,
    source: null,
    caption: p.eligibility.voting ? `Voting on ${p.eligibility.voting.chainName} not yet started` : 'No vote yet',
  };
};
