import {describe, expect, test} from 'bun:test';
import {GovernanceV3Ethereum, GovernanceV3Polygon} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {activateVotingAction} from '../src/core/actions/activateVoting';
import {cancelProposalAction} from '../src/core/actions/cancelProposal';
import {closeAndSendVoteAction} from '../src/core/actions/closeAndSendVote';
import {createVoteAction} from '../src/core/actions/createVote';
import {executePayloadAction} from '../src/core/actions/executePayload';
import {executeProposalAction} from '../src/core/actions/executeProposal';
import {VOTING_CHAINS} from '../src/core/chains';
import type {ActionModule} from '../src/core/context';
import {completionSearchStart} from '../src/core/frontrun';
import {makeMockClient, silentLogger} from './helpers/mockClient';

const OTHER = ('0x' + '22'.repeat(20)) as Address;
const OTHER_TX = ('0x' + 'dd'.repeat(32)) as Hex;

const ctxWithEvents = (chainId: number, events: unknown[]) => {
  const queries: Array<Record<string, unknown>> = [];
  const publicClient = makeMockClient({}, {chainId});
  Object.assign(publicClient, {
    getContractEvents: async (q: Record<string, unknown>) => {
      queries.push(q);
      return events;
    },
    getTransaction: async () => ({from: OTHER}),
  });
  return {ctx: {chainId, logger: silentLogger, publicClient}, queries};
};

describe('findCompletion', () => {
  const cases: Array<[ActionModule<bigint>, number, string, string]> = [
    [executeProposalAction, 1, GovernanceV3Ethereum.GOVERNANCE, 'ProposalExecuted'],
    [activateVotingAction, 1, GovernanceV3Ethereum.GOVERNANCE, 'VotingActivated'],
    [cancelProposalAction, 1, GovernanceV3Ethereum.GOVERNANCE, 'ProposalCanceled'],
    [createVoteAction, 137, VOTING_CHAINS[137]!.votingMachine, 'ProposalVoteStarted'],
    [closeAndSendVoteAction, 137, VOTING_CHAINS[137]!.votingMachine, 'ProposalResultsSent'],
  ];

  for (const [action, chainId, address, eventName] of cases) {
    test(`${action.name} filters ${eventName} by indexed proposalId`, async () => {
      const {ctx, queries} = ctxWithEvents(chainId, [
        {transactionHash: OTHER_TX, args: {proposalId: 42n}},
      ]);
      const out = await action.findCompletion!(ctx, 42n, 9_000n);
      expect(out).toEqual({txHash: OTHER_TX, from: OTHER});
      expect(queries[0]?.address).toBe(address);
      expect(queries[0]?.eventName).toBe(eventName);
      expect(queries[0]?.args).toEqual({proposalId: 42n});
      expect(queries[0]?.fromBlock).toBe(9_000n);
    });
  }

  test('executePayload matches the unindexed payloadId client-side', async () => {
    const {ctx, queries} = ctxWithEvents(137, [
      {transactionHash: ('0x' + 'ee'.repeat(32)) as Hex, args: {payloadId: 41}},
    ]);
    expect(await executePayloadAction.findCompletion!(ctx, 42n, 0n)).toBeNull();
    expect(queries[0]?.address).toBe(GovernanceV3Polygon.PAYLOADS_CONTROLLER);
    expect(queries[0]?.args).toBeUndefined();
  });

  test('returns null when no completion event exists', async () => {
    const {ctx} = ctxWithEvents(1, []);
    expect(await executeProposalAction.findCompletion!(ctx, 42n, 0n)).toBeNull();
  });
});

describe('completionSearchStart', () => {
  test('looks back 1000 blocks, floored at genesis', async () => {
    const client = makeMockClient({});
    expect(await completionSearchStart(client)).toBe(9_000n);
    Object.assign(client, {getBlockNumber: async () => 400n});
    expect(await completionSearchStart(client)).toBe(0n);
  });
});
