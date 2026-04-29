import {describe, expect, test} from 'bun:test';
import {
  PayloadState,
  ProposalState,
  VotingMachineProposalState,
  isProposalFinal,
  payloadStateName,
  proposalStateName,
  votingProposalStateName,
} from '../src/core/state';

describe('proposalStateName', () => {
  test('renders every defined enum value', () => {
    expect(proposalStateName(ProposalState.Null)).toBe('Null');
    expect(proposalStateName(ProposalState.Created)).toBe('Created');
    expect(proposalStateName(ProposalState.Active)).toBe('Active');
    expect(proposalStateName(ProposalState.Queued)).toBe('Queued');
    expect(proposalStateName(ProposalState.Executed)).toBe('Executed');
    expect(proposalStateName(ProposalState.Failed)).toBe('Failed');
    expect(proposalStateName(ProposalState.Cancelled)).toBe('Cancelled');
    expect(proposalStateName(ProposalState.Expired)).toBe('Expired');
  });

  test('renders unknown values', () => {
    expect(proposalStateName(99)).toBe('Unknown(99)');
  });
});

describe('payloadStateName', () => {
  test('renders every defined enum value', () => {
    expect(payloadStateName(PayloadState.None)).toBe('None');
    expect(payloadStateName(PayloadState.Created)).toBe('Created');
    expect(payloadStateName(PayloadState.Queued)).toBe('Queued');
    expect(payloadStateName(PayloadState.Executed)).toBe('Executed');
    expect(payloadStateName(PayloadState.Cancelled)).toBe('Cancelled');
    expect(payloadStateName(PayloadState.Expired)).toBe('Expired');
  });

  test('renders unknown values', () => {
    expect(payloadStateName(42)).toBe('Unknown(42)');
  });
});

describe('votingProposalStateName', () => {
  test('renders every defined enum value', () => {
    expect(votingProposalStateName(VotingMachineProposalState.NotCreated)).toBe('NotCreated');
    expect(votingProposalStateName(VotingMachineProposalState.Active)).toBe('Active');
    expect(votingProposalStateName(VotingMachineProposalState.Finished)).toBe('Finished');
    expect(votingProposalStateName(VotingMachineProposalState.SentToGovernance)).toBe(
      'SentToGovernance',
    );
  });

  test('renders unknown values', () => {
    expect(votingProposalStateName(7)).toBe('Unknown(7)');
  });
});

describe('isProposalFinal', () => {
  test('non-final states', () => {
    expect(isProposalFinal(ProposalState.Null)).toBe(false);
    expect(isProposalFinal(ProposalState.Created)).toBe(false);
    expect(isProposalFinal(ProposalState.Active)).toBe(false);
    expect(isProposalFinal(ProposalState.Queued)).toBe(false);
  });

  test('final states (anything > Queued)', () => {
    expect(isProposalFinal(ProposalState.Executed)).toBe(true);
    expect(isProposalFinal(ProposalState.Failed)).toBe(true);
    expect(isProposalFinal(ProposalState.Cancelled)).toBe(true);
    expect(isProposalFinal(ProposalState.Expired)).toBe(true);
  });
});
