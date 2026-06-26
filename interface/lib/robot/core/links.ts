// Deep-link builders for lifecycle notifications. Pure string templates — no I/O, can't
// throw on valid input. Callers still wrap each call in try/catch (per the explicit
// requirement that link-building failures must never block the underlying notification).

import type {Hex} from 'viem';

/** Public Aave vote dashboard, e.g. https://vote.tools.aave.com/proposal/?proposalId=486 */
export const aaveVoteUrl = (proposalId: bigint | string | number): string =>
  `https://vote.tools.aave.com/proposal/?proposalId=${proposalId.toString()}`;

/** This repo's operator dashboard (Vercel-deployed Next.js). */
export const operatorDashboardUrl = (proposalId: bigint | string | number): string =>
  `https://aave-governance-v3-robot-lemon.vercel.app/proposal/${proposalId.toString()}`;

/**
 * Aave Delivery Infrastructure envelope tracker, e.g.
 *   https://adi.tools.aave.com/envelope/0xf6e546c8364cdb0ca2b8c20692c48d157875e956dcbbe28cd0b9dce8fd8e42d7
 * Used for cross-chain hops triggered by executeProposal (L1 → execution chains) and
 * closeAndSendVote (voting chain → L1).
 */
export const adiEnvelopeUrl = (envelopeId: Hex): string =>
  `https://adi.tools.aave.com/envelope/${envelopeId}`;
