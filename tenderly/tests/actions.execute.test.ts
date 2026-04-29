import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {
  GovernanceV3Avalanche,
  GovernanceV3Ethereum,
  GovernanceV3Polygon,
} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {activateVotingAction} from '../src/core/actions/activateVoting';
import {executeProposalAction} from '../src/core/actions/executeProposal';
import {cancelProposalAction} from '../src/core/actions/cancelProposal';
import {executePayloadAction} from '../src/core/actions/executePayload';
import {createVoteAction} from '../src/core/actions/createVote';
import {closeAndSendVoteAction} from '../src/core/actions/closeAndSendVote';
import {PayloadState, ProposalState, VotingMachineProposalState} from '../src/core/state';
import {
  makeMockClient,
  makeMockWalletClient,
  makeWalletSpy,
  silentLogger,
  type Mocks,
} from './helpers/mockClient';

// Strip notification channels so notifyTxSuccess is a no-op for these tests.
const ORIGINAL_ENV = {...process.env};
beforeAll(() => {
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_WEBHOOK_URL;
});
afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL_ENV)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

const ACCOUNT = ('0x' + '99'.repeat(20)) as Address;
const TX = ('0x' + 'cd'.repeat(32)) as Hex;
const GOV = GovernanceV3Ethereum.GOVERNANCE.toLowerCase();
const POWER = GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY.toLowerCase();

const buildWriteCtx = (chainId: number, mocks: Mocks) => {
  const spy = makeWalletSpy(TX);
  return {
    spy,
    ctx: {
      chainId,
      logger: silentLogger,
      publicClient: makeMockClient(mocks, {chainId}),
      walletClient: makeMockWalletClient(spy, {chainId, account: ACCOUNT}),
      account: ACCOUNT,
    },
  };
};

const now = () => Math.floor(Date.now() / 1000);

const proposalReady = (overrides: Record<string, unknown> = {}) => ({
  state: ProposalState.Created,
  accessLevel: 1,
  creationTime: now() - 86_400,
  votingDuration: 86_400,
  votingActivationTime: 0,
  queuingTime: 0,
  cancelTimestamp: 0,
  creator: '0x0000000000000000000000000000000000000001',
  votingPortal: GovernanceV3Ethereum.VOTING_PORTAL_ETH_ETH,
  snapshotBlockHash: '0xab',
  ipfsHash: '0xcd',
  forVotes: 0n,
  againstVotes: 0n,
  cancellationFee: 0n,
  payloads: [],
  ...overrides,
});

const baseVotingConfig = {
  coolDownBeforeVotingStart: 60,
  votingDuration: 86_400,
  yesThreshold: 0n,
  yesNoDifferential: 0n,
  minPropositionPower: 80_000n,
};

describe('activateVotingAction.execute', () => {
  test('writes activateVoting on the governance contract and returns txHash', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady(),
      [`${GOV}.getVotingConfig`]: baseVotingConfig,
    });
    const out = await activateVotingAction.execute(ctx, 42n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(GOV);
    expect(spy.calls[0]?.functionName).toBe('activateVoting');
    expect(spy.calls[0]?.args).toEqual([42n]);
  });

  test('throws when precheck fails (state ≠ Created) and never writes', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady({state: ProposalState.Active}),
      [`${GOV}.getVotingConfig`]: baseVotingConfig,
    });
    await expect(activateVotingAction.execute(ctx, 1n)).rejects.toThrow(
      /activateVoting precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('executeProposalAction.execute', () => {
  test('writes executeProposal on the governance contract', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady({
        state: ProposalState.Queued,
        queuingTime: now() - 100_000,
      }),
      [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
    });
    const out = await executeProposalAction.execute(ctx, 7n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls[0]?.functionName).toBe('executeProposal');
    expect(spy.calls[0]?.args).toEqual([7n]);
  });

  test('throws when precheck fails (state ≠ Queued)', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady({state: ProposalState.Active}),
      [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
    });
    await expect(executeProposalAction.execute(ctx, 1n)).rejects.toThrow(
      /executeProposal precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('cancelProposalAction.execute', () => {
  test('writes cancelProposal on the governance contract', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady({state: ProposalState.Active}),
      [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
      [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
      [`${GOV}.getVotingConfig`]: baseVotingConfig,
      [`${POWER}.getFullPropositionPower`]: 0n,
    });
    const out = await cancelProposalAction.execute(ctx, 11n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls[0]?.functionName).toBe('cancelProposal');
    expect(spy.calls[0]?.args).toEqual([11n]);
  });

  test('throws when precheck fails (creator power still high)', async () => {
    const {spy, ctx} = buildWriteCtx(1, {
      [`${GOV}.getProposal`]: proposalReady({state: ProposalState.Active}),
      [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
      [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
      [`${GOV}.getVotingConfig`]: baseVotingConfig,
      [`${POWER}.getFullPropositionPower`]: 10n ** 30n,
    });
    await expect(cancelProposalAction.execute(ctx, 1n)).rejects.toThrow(
      /cancelProposal precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('executePayloadAction.execute', () => {
  const PC_POL = GovernanceV3Polygon.PAYLOADS_CONTROLLER.toLowerCase();
  const readyPayload = {
    creator: '0x0',
    maximumAccessLevelRequired: 1,
    state: PayloadState.Queued,
    createdAt: 0,
    queuedAt: now() - 100_000,
    executedAt: 0,
    cancelledAt: 0,
    expirationTime: 0,
    delay: 1000,
    gracePeriod: 432_000,
    actions: [],
  };

  test('writes executePayload on the chain-specific PayloadsController', async () => {
    const {spy, ctx} = buildWriteCtx(137, {
      [`${PC_POL}.getPayloadById`]: readyPayload,
    });
    const out = await executePayloadAction.execute(ctx, 5n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(PC_POL);
    expect(spy.calls[0]?.functionName).toBe('executePayload');
    // Source converts bigint → number for this on-chain function signature.
    expect(spy.calls[0]?.args).toEqual([5]);
  });

  test('throws when precheck fails (still in delay window)', async () => {
    const {spy, ctx} = buildWriteCtx(137, {
      [`${PC_POL}.getPayloadById`]: {
        ...readyPayload,
        queuedAt: now(),
        delay: 100_000,
      },
    });
    await expect(executePayloadAction.execute(ctx, 1n)).rejects.toThrow(
      /executePayload precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('createVoteAction.execute', () => {
  const VM_POL = GovernanceV3Polygon.VOTING_MACHINE.toLowerCase();
  const STRAT_POL = GovernanceV3Polygon.VOTING_STRATEGY.toLowerCase();
  const WAREHOUSE_POL = GovernanceV3Polygon.DATA_WAREHOUSE.toLowerCase();
  const BLOCK = ('0x' + 'aa'.repeat(32)) as `0x${string}`;

  test('writes startProposalVote on the polygon voting machine', async () => {
    const {spy, ctx} = buildWriteCtx(137, {
      [`${VM_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
      [`${VM_POL}.getProposalVoteConfiguration`]: {votingDuration: 86_400, l1ProposalBlockHash: BLOCK},
      [`${STRAT_POL}.hasRequiredRoots`]: undefined,
      [`${WAREHOUSE_POL}.getStorageRoots`]: '0x' + 'cd'.repeat(32),
    });
    const out = await createVoteAction.execute(ctx, 13n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(VM_POL);
    expect(spy.calls[0]?.functionName).toBe('startProposalVote');
    expect(spy.calls[0]?.args).toEqual([13n]);
  });

  test('throws when precheck fails (state ≠ NotCreated)', async () => {
    const {spy, ctx} = buildWriteCtx(137, {
      [`${VM_POL}.getProposalState`]: VotingMachineProposalState.Active,
    });
    await expect(createVoteAction.execute(ctx, 1n)).rejects.toThrow(
      /createVote precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('closeAndSendVoteAction.execute', () => {
  const VM_AVAX = GovernanceV3Avalanche.VOTING_MACHINE.toLowerCase();

  test('writes closeAndSendVote on the avalanche voting machine', async () => {
    const {spy, ctx} = buildWriteCtx(43114, {
      [`${VM_AVAX}.getProposalState`]: VotingMachineProposalState.Finished,
    });
    const out = await closeAndSendVoteAction.execute(ctx, 21n);
    expect(out.txHash).toBe(TX);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(VM_AVAX);
    expect(spy.calls[0]?.functionName).toBe('closeAndSendVote');
    expect(spy.calls[0]?.args).toEqual([21n]);
  });

  test('throws when precheck fails (state ≠ Finished)', async () => {
    const {spy, ctx} = buildWriteCtx(43114, {
      [`${VM_AVAX}.getProposalState`]: VotingMachineProposalState.Active,
    });
    await expect(closeAndSendVoteAction.execute(ctx, 1n)).rejects.toThrow(
      /closeAndSendVote precheck failed/,
    );
    expect(spy.calls.length).toBe(0);
  });
});

describe('action module wrappers', () => {
  test('every action exposes name + check + execute', () => {
    const actions = [
      activateVotingAction,
      executeProposalAction,
      cancelProposalAction,
      executePayloadAction,
      createVoteAction,
      closeAndSendVoteAction,
    ];
    for (const a of actions) {
      expect(typeof a.name).toBe('string');
      expect(typeof a.check).toBe('function');
      expect(typeof a.execute).toBe('function');
    }
  });
});
