import {describe, expect, test} from 'bun:test';
import {GovernanceV3Ethereum, GovernanceV3Polygon} from '@aave-dao/aave-address-book';
import {checkActivateVoting} from '../src/core/actions/activateVoting';
import {checkExecuteProposal} from '../src/core/actions/executeProposal';
import {checkCancelProposal} from '../src/core/actions/cancelProposal';
import {checkExecutePayload} from '../src/core/actions/executePayload';
import {checkCreateVote} from '../src/core/actions/createVote';
import {checkCloseAndSendVote} from '../src/core/actions/closeAndSendVote';
import {checkSubmitStorageRoots} from '../src/core/actions/submitStorageRoots';
import {PayloadState, ProposalState, VotingMachineProposalState} from '../src/core/state';
import {makeMockClient, silentLogger} from './helpers/mockClient';

const GOV = GovernanceV3Ethereum.GOVERNANCE.toLowerCase();
const POWER = GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY.toLowerCase();

const baseProposal = {
  state: ProposalState.Created,
  accessLevel: 1,
  creationTime: 1_700_000_000,
  votingDuration: 86_400,
  votingActivationTime: 0,
  queuingTime: 0,
  cancelTimestamp: 0,
  creator: '0x0000000000000000000000000000000000000001',
  votingPortal: '0xf23f7De3AC42F22eBDA17e64DC4f51FB66b8E21f',
  snapshotBlockHash: '0xab',
  ipfsHash: '0xcd',
  forVotes: 0n,
  againstVotes: 0n,
  cancellationFee: 0n,
  payloads: [],
};

const baseVotingConfig = {
  coolDownBeforeVotingStart: 60 * 60, // 1h
  votingDuration: 86_400,
  yesThreshold: 0n,
  yesNoDifferential: 0n,
  minPropositionPower: 80_000n,
};

describe('checkActivateVoting', () => {
  test('rejects when state is not Created', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, state: ProposalState.Active},
        [`${GOV}.getVotingConfig`]: baseVotingConfig,
      }),
    };
    const out = await checkActivateVoting(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('Active');
  });

  test('rejects while cooldown still active', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, creationTime: Number(now) - 30},
        [`${GOV}.getVotingConfig`]: {...baseVotingConfig, coolDownBeforeVotingStart: 3600},
      }),
    };
    const out = await checkActivateVoting(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('cooldown');
  });

  test('accepts after cooldown', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, creationTime: Number(now) - 7200},
        [`${GOV}.getVotingConfig`]: {...baseVotingConfig, coolDownBeforeVotingStart: 3600},
      }),
    };
    const out = await checkActivateVoting(ctx, 1n);
    expect(out.ok).toBe(true);
  });
});

describe('checkExecuteProposal', () => {
  test('rejects when not Queued', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, state: ProposalState.Active},
        [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
      }),
    };
    const out = await checkExecuteProposal(ctx, 1n);
    expect(out.ok).toBe(false);
  });

  test('rejects while cooldown active', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {
          ...baseProposal,
          state: ProposalState.Queued,
          queuingTime: Number(now) - 100,
        },
        [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
      }),
    };
    const out = await checkExecuteProposal(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('cooldown');
  });

  test('accepts after cooldown', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {
          ...baseProposal,
          state: ProposalState.Queued,
          queuingTime: Number(now) - 100_000,
        },
        [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
      }),
    };
    const out = await checkExecuteProposal(ctx, 1n);
    expect(out.ok).toBe(true);
  });
});

describe('checkCancelProposal', () => {
  test('rejects in final state', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, state: ProposalState.Executed},
        [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
        [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
        [`${GOV}.getVotingConfig`]: baseVotingConfig,
        [`${POWER}.getFullPropositionPower`]: 0n,
      }),
    };
    const out = await checkCancelProposal(ctx, 1n);
    expect(out.ok).toBe(false);
  });

  test('rejects when creator still has enough power', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, state: ProposalState.Active},
        [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
        [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
        [`${GOV}.getVotingConfig`]: baseVotingConfig,
        [`${POWER}.getFullPropositionPower`]: 10n ** 24n, // way more than min
      }),
    };
    const out = await checkCancelProposal(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('power');
  });

  test('accepts when creator power has dropped', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${GOV}.getProposal`]: {...baseProposal, state: ProposalState.Active},
        [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
        [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
        [`${GOV}.getVotingConfig`]: {...baseVotingConfig, minPropositionPower: 80_000n},
        [`${POWER}.getFullPropositionPower`]: 0n,
      }),
    };
    const out = await checkCancelProposal(ctx, 1n);
    expect(out.ok).toBe(true);
  });
});

describe('checkExecutePayload', () => {
  const PC = GovernanceV3Ethereum.PAYLOADS_CONTROLLER.toLowerCase();
  const basePayload = {
    creator: '0x0',
    maximumAccessLevelRequired: 1,
    state: PayloadState.Queued,
    createdAt: 0,
    queuedAt: 0,
    executedAt: 0,
    cancelledAt: 0,
    expirationTime: 0,
    delay: 86_400,
    gracePeriod: 432_000,
    actions: [],
  };

  test('rejects when not Queued', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${PC}.getPayloadById`]: {...basePayload, state: PayloadState.Executed},
      }),
    };
    const out = await checkExecutePayload(ctx, 1n);
    expect(out.ok).toBe(false);
  });

  test('rejects while delay still active', async () => {
    const now = Math.floor(Date.now() / 1000);
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${PC}.getPayloadById`]: {...basePayload, queuedAt: now - 100, delay: 1000},
      }),
    };
    const out = await checkExecutePayload(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('delay');
  });

  test('accepts after delay', async () => {
    const now = Math.floor(Date.now() / 1000);
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${PC}.getPayloadById`]: {...basePayload, queuedAt: now - 100_000, delay: 1000},
      }),
    };
    const out = await checkExecutePayload(ctx, 1n);
    expect(out.ok).toBe(true);
  });

  test('rejects when expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${PC}.getPayloadById`]: {
          ...basePayload,
          queuedAt: now - 100_000,
          delay: 1000,
          expirationTime: now - 10,
        },
      }),
    };
    const out = await checkExecutePayload(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('expired');
  });
});

// -------------------- voting-chain actions --------------------

const VMACHINE_POL = GovernanceV3Polygon.VOTING_MACHINE.toLowerCase();
const STRATEGY_POL = GovernanceV3Polygon.VOTING_STRATEGY.toLowerCase();
const WAREHOUSE_POL = GovernanceV3Polygon.DATA_WAREHOUSE.toLowerCase();
const GOV_L1 = GovernanceV3Ethereum.GOVERNANCE.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const BLOCK = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

const baseVoteConfig = {votingDuration: 86_400, l1ProposalBlockHash: BLOCK};

describe('checkCreateVote', () => {
  test('rejects when vm state ≠ NotCreated (Active)', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.Active,
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('Active');
  });

  test('rejects when vm state ≠ NotCreated (Finished)', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.Finished,
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('Finished');
  });

  test('rejects when voteConfig.l1ProposalBlockHash is ZERO', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
        [`${VMACHINE_POL}.getProposalVoteConfiguration`]: {
          votingDuration: 0,
          l1ProposalBlockHash: ZERO,
        },
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('not yet bridged');
  });

  test('rejects when hasRequiredRoots throws', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
        [`${VMACHINE_POL}.getProposalVoteConfiguration`]: baseVoteConfig,
        [`${STRATEGY_POL}.hasRequiredRoots`]: () => {
          throw new Error('not all roots present');
        },
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('roots not yet registered');
  });

  test('rejects when getStorageRoots returns ZERO despite hasRequiredRoots success', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
        [`${VMACHINE_POL}.getProposalVoteConfiguration`]: baseVoteConfig,
        [`${STRATEGY_POL}.hasRequiredRoots`]: undefined, // void return
        [`${WAREHOUSE_POL}.getStorageRoots`]: ZERO,
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('roots not yet registered');
  });

  test('accepts when state==NotCreated, blockHash set, roots ready', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
        [`${VMACHINE_POL}.getProposalVoteConfiguration`]: baseVoteConfig,
        [`${STRATEGY_POL}.hasRequiredRoots`]: undefined,
        [`${WAREHOUSE_POL}.getStorageRoots`]: '0x' + 'cd'.repeat(32),
      }),
    };
    const out = await checkCreateVote(ctx, 1n);
    expect(out.ok).toBe(true);
  });

  test('throws when chainId is not a configured voting chain', async () => {
    const ctx = {chainId: 99999, logger: silentLogger, publicClient: makeMockClient({})};
    await expect(checkCreateVote(ctx, 1n)).rejects.toThrow(/not a voting chain/);
  });
});

describe('checkCloseAndSendVote', () => {
  test('rejects when state is NotCreated', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.NotCreated,
      }),
    };
    const out = await checkCloseAndSendVote(ctx, 1n);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('NotCreated');
  });

  test('rejects when state is Active', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.Active,
      }),
    };
    const out = await checkCloseAndSendVote(ctx, 1n);
    expect(out.ok).toBe(false);
  });

  test('rejects when state is SentToGovernance', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.SentToGovernance,
      }),
    };
    const out = await checkCloseAndSendVote(ctx, 1n);
    expect(out.ok).toBe(false);
  });

  test('accepts when state is Finished', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${VMACHINE_POL}.getProposalState`]: VotingMachineProposalState.Finished,
      }),
    };
    const out = await checkCloseAndSendVote(ctx, 1n);
    expect(out.ok).toBe(true);
  });

  test('throws when chainId is not a configured voting chain', async () => {
    const ctx = {chainId: 99999, logger: silentLogger, publicClient: makeMockClient({})};
    await expect(checkCloseAndSendVote(ctx, 1n)).rejects.toThrow(/not a voting chain/);
  });
});

describe('checkSubmitStorageRoots', () => {
  test('rejects on ZERO blockHash', async () => {
    const ctx = {chainId: 137, logger: silentLogger, publicClient: makeMockClient({})};
    const out = await checkSubmitStorageRoots(ctx, {
      proposalId: 1n,
      l1ProposalBlockHash: ZERO,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('no snapshot block hash');
  });

  test('rejects when roots are already registered (idempotency)', async () => {
    // hasRequiredRoots success + non-zero govRoot ⇒ ready, so submit-roots is unnecessary.
    void GOV_L1; // referenced in the warehouse mock below
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${STRATEGY_POL}.hasRequiredRoots`]: undefined,
        [`${WAREHOUSE_POL}.getStorageRoots`]: '0x' + '11'.repeat(32),
      }),
    };
    const out = await checkSubmitStorageRoots(ctx, {
      proposalId: 1n,
      l1ProposalBlockHash: BLOCK,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('already registered');
  });

  test('accepts when roots are not yet present (hasRequiredRoots reverts)', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${STRATEGY_POL}.hasRequiredRoots`]: () => {
          throw new Error('not yet');
        },
      }),
    };
    const out = await checkSubmitStorageRoots(ctx, {
      proposalId: 1n,
      l1ProposalBlockHash: BLOCK,
    });
    expect(out.ok).toBe(true);
  });

  test('accepts when hasRequiredRoots passes but govRoot is ZERO', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({
        [`${STRATEGY_POL}.hasRequiredRoots`]: undefined,
        [`${WAREHOUSE_POL}.getStorageRoots`]: ZERO,
      }),
    };
    const out = await checkSubmitStorageRoots(ctx, {
      proposalId: 1n,
      l1ProposalBlockHash: BLOCK,
    });
    expect(out.ok).toBe(true);
  });
});
