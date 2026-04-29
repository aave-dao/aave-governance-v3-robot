// Mirrors enums from lib/aave-governance-v3 — see Solidity sources for source of truth.

// IGovernanceCore.State
export enum ProposalState {
  Null = 0,
  Created = 1,
  Active = 2,
  Queued = 3,
  Executed = 4,
  Failed = 5,
  Cancelled = 6,
  Expired = 7,
}

export const proposalStateName = (s: number): string => ProposalState[s] ?? `Unknown(${s})`;

export const isProposalFinal = (s: number): boolean => s > ProposalState.Queued;

// IVotingMachineWithProofs.ProposalState
export enum VotingMachineProposalState {
  NotCreated = 0,
  Active = 1,
  Finished = 2,
  SentToGovernance = 3,
}

export const votingProposalStateName = (s: number): string =>
  VotingMachineProposalState[s] ?? `Unknown(${s})`;

// IPayloadsControllerCore.PayloadState
export enum PayloadState {
  None = 0,
  Created = 1,
  Queued = 2,
  Executed = 3,
  Cancelled = 4,
  Expired = 5,
}

export const payloadStateName = (s: number): string => PayloadState[s] ?? `Unknown(${s})`;
