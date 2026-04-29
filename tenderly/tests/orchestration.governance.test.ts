import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {
  MAX_GOVERNANCE_ACTIONS,
  MAX_GOVERNANCE_SKIP,
  runGovernanceScan,
  scanGovernanceChain,
} from '../src/orchestration/governanceScan';
import {ProposalState} from '../src/core/state';
import {
  makeMockClient,
  makeMockWalletClient,
  makeWalletSpy,
  silentLogger,
  type Mocks,
} from './helpers/mockClient';

const GOV = GovernanceV3Ethereum.GOVERNANCE.toLowerCase();
const POWER = GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY.toLowerCase();
const ACCOUNT = ('0x' + '99'.repeat(20)) as Address;
const TX = ('0x' + 'cc'.repeat(32)) as Hex;

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

const now = () => Math.floor(Date.now() / 1000);

const makeProposal = (overrides: Record<string, unknown> = {}) => ({
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

/**
 * Build a `Mocks` table where `getProposalsCount` returns `count` and `getProposal` answers
 * by id, looking up `byId[id]` (defaulting to a "Created and ready" proposal so most slots
 * are actionable).
 */
const buildMocks = (
  count: bigint,
  byId: Record<string, ReturnType<typeof makeProposal>>,
): Mocks => ({
  [`${GOV}.getProposalsCount`]: count,
  [`${GOV}.getProposal`]: (args: readonly unknown[]) => {
    const id = String(args[0]);
    return byId[id] ?? makeProposal({state: ProposalState.Executed}); // final by default
  },
  [`${GOV}.getVotingConfig`]: baseVotingConfig,
  [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
  [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
  [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
  [`${POWER}.getFullPropositionPower`]: 10n ** 30n, // way above min — cancel always rejects
});

const ctxFor = (count: bigint, byId: Record<string, ReturnType<typeof makeProposal>>) => ({
  chainId: 1,
  logger: silentLogger,
  publicClient: makeMockClient(buildMocks(count, byId), {chainId: 1}),
});

describe('scanGovernanceChain', () => {
  test('returns [] when no proposals exist', async () => {
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient(
        {
          [`${GOV}.getProposalsCount`]: 0n,
          [`${GOV}.getProposal`]: () => makeProposal(),
        },
        {chainId: 1},
      ),
    };
    const out = await scanGovernanceChain(ctx);
    expect(out).toEqual([]);
  });

  test('finds a single actionable proposal at the top of the stack', async () => {
    const ctx = ctxFor(3n, {
      '2': makeProposal({state: ProposalState.Created}),
      '1': makeProposal({state: ProposalState.Executed}),
      '0': makeProposal({state: ProposalState.Executed}),
    });
    const out = await scanGovernanceChain(ctx);
    expect(out.length).toBe(1);
    expect(out[0]?.proposalId).toBe(2n);
    expect(out[0]?.action.name).toBe('activateVoting');
  });

  test('priority order: cancel > activate when both check pass', async () => {
    // Power = 0 → cancel passes. State Created + cooldown elapsed → activate also passes.
    // Cancel is first in GOV_PRIORITY so it must win.
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient(
        {
          ...buildMocks(1n, {'0': makeProposal()}),
          [`${POWER}.getFullPropositionPower`]: 0n,
        },
        {chainId: 1},
      ),
    };
    const out = await scanGovernanceChain(ctx);
    expect(out[0]?.action.name).toBe('cancelProposal');
  });

  test('skipCount > MAX_SKIP terminates the scan', async () => {
    // 22 final proposals in a row: scan should stop once skipCount > MAX_GOVERNANCE_SKIP.
    const finals: Record<string, ReturnType<typeof makeProposal>> = {};
    for (let i = 0; i < 22; i++) {
      finals[String(i)] = makeProposal({state: ProposalState.Executed});
    }
    const ctx = ctxFor(22n, finals);
    const out = await scanGovernanceChain(ctx);
    expect(out).toEqual([]);
  });

  test('skipCount resets after a hit, so we can scan past 20+ skips when interleaved', async () => {
    // Place 1 actionable proposal at id 25, then 25 final proposals before it.
    const byId: Record<string, ReturnType<typeof makeProposal>> = {};
    for (let i = 0; i < 25; i++) {
      byId[String(i)] = makeProposal({state: ProposalState.Executed});
    }
    byId['25'] = makeProposal();
    const ctx = ctxFor(26n, byId);
    const out = await scanGovernanceChain(ctx);
    expect(out.length).toBe(1);
    expect(out[0]?.proposalId).toBe(25n);
  });

  test('caps at MAX_GOVERNANCE_ACTIONS = 5', async () => {
    const byId: Record<string, ReturnType<typeof makeProposal>> = {};
    for (let i = 0; i < 10; i++) byId[String(i)] = makeProposal(); // all actionable
    const ctx = ctxFor(10n, byId);
    const out = await scanGovernanceChain(ctx);
    expect(out.length).toBe(MAX_GOVERNANCE_ACTIONS);
    expect(MAX_GOVERNANCE_SKIP).toBe(20);
  });
});

describe('runGovernanceScan', () => {
  test('happy path: every scanned action produces a txHash', async () => {
    const spy = makeWalletSpy(TX);
    const ctx = {
      ...ctxFor(1n, {'0': makeProposal()}),
      walletClient: makeMockWalletClient(spy, {chainId: 1, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const results = await runGovernanceScan(ctx);
    expect(results.length).toBe(1);
    expect(results[0]?.txHash).toBe(TX);
    expect(results[0]?.action).toBe('activateVoting');
    expect(spy.calls[0]?.functionName).toBe('activateVoting');
  });

  test('records error when execute throws', async () => {
    const spy = makeWalletSpy(TX);
    spy.shouldThrow = new Error('rpc went away');
    const ctx = {
      ...ctxFor(1n, {'0': makeProposal()}),
      walletClient: makeMockWalletClient(spy, {chainId: 1, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const results = await runGovernanceScan(ctx);
    expect(results[0]?.txHash).toBeUndefined();
    expect(results[0]?.error).toContain('rpc went away');
  });

  test('records recheck-fail when proposition power recovers between scan and execute', async () => {
    // Cancel passes during scan (power=0), then on the recheck before execute, power has
    // recovered and cancel rejects → records error, never calls writeContract.
    let powerReadCount = 0;
    const spy = makeWalletSpy(TX);
    const ctx = {
      chainId: 1,
      logger: silentLogger,
      publicClient: makeMockClient(
        {
          [`${GOV}.getProposalsCount`]: 1n,
          [`${GOV}.getProposal`]: makeProposal(),
          [`${GOV}.getVotingConfig`]: baseVotingConfig,
          [`${GOV}.COOLDOWN_PERIOD`]: 86_400n,
          [`${GOV}.getPowerStrategy`]: GovernanceV3Ethereum.GOVERNANCE_POWER_STRATEGY,
          [`${GOV}.PRECISION_DIVIDER`]: 10n ** 18n,
          [`${POWER}.getFullPropositionPower`]: () => {
            powerReadCount += 1;
            return powerReadCount === 1 ? 0n : 10n ** 30n;
          },
        },
        {chainId: 1},
      ),
      walletClient: makeMockWalletClient(spy, {chainId: 1, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const results = await runGovernanceScan(ctx);
    expect(results.length).toBe(1);
    expect(results[0]?.txHash).toBeUndefined();
    expect(results[0]?.error).toBeDefined();
    expect(spy.calls.length).toBe(0);
  });
});
