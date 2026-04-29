// Derives the user-facing proposal state from the L1 chain state + per-payload states.
//
// L1 governance state moves to "Executed" as soon as `executeProposal` is called and the
// cross-chain message is sent. Actual payload execution on each chain happens *after* that —
// payloads still need to be queued (cross-chain bridge) and then executed (after delay).
//
// So the right user-facing label until every payload is settled is "Executing", not "Executed".

import type { EligibilityBlob } from '@/db/schema';

// PayloadState (mirrors @robot/core/state):
//   None=0, Created=1, Queued=2, Executed=3, Cancelled=4, Expired=5
const PAYLOAD_TERMINAL: Record<number, true> = { 3: true, 4: true, 5: true };

// ProposalState (mirrors @robot/core/state):
//   Null=0, Created=1, Active=2, Queued=3, Executed=4, Failed=5, Cancelled=6, Expired=7
const L1_EXECUTED = 4;

export const displayStateName = (
  l1State: number,
  l1StateName: string,
  payloads: EligibilityBlob['payloads'] | undefined,
): string => {
  if (l1State !== L1_EXECUTED) return l1StateName;
  if (!payloads || payloads.length === 0) return l1StateName;
  const allTerminal = payloads.every((p) => PAYLOAD_TERMINAL[p.stateNumber] === true);
  return allTerminal ? l1StateName : 'Executing';
};
