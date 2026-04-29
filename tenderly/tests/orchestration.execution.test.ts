import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {GovernanceV3Polygon} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {
  MAX_EXECUTION_ACTIONS,
  MAX_EXECUTION_SKIP,
  runExecutionScan,
  scanExecutionChain,
} from '../src/orchestration/executionScan';
import {PayloadState} from '../src/core/state';
import {
  makeMockClient,
  makeMockWalletClient,
  makeWalletSpy,
  silentLogger,
  type Mocks,
} from './helpers/mockClient';

const PC = GovernanceV3Polygon.PAYLOADS_CONTROLLER.toLowerCase();
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

const makePayload = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const buildMocks = (
  count: number,
  byId: Record<string, ReturnType<typeof makePayload>>,
): Mocks => ({
  [`${PC}.getPayloadsCount`]: count,
  [`${PC}.getPayloadById`]: (args: readonly unknown[]) => {
    const id = String(args[0]);
    return byId[id] ?? makePayload({state: PayloadState.Executed});
  },
});

const ctxFor = (count: number, byId: Record<string, ReturnType<typeof makePayload>>) => ({
  chainId: 137,
  logger: silentLogger,
  publicClient: makeMockClient(buildMocks(count, byId), {chainId: 137}),
});

describe('scanExecutionChain', () => {
  test('returns [] when no payloads exist', async () => {
    const ctx = ctxFor(0, {});
    expect(await scanExecutionChain(ctx)).toEqual([]);
  });

  test('finds the actionable payload at the top of the stack', async () => {
    const ctx = ctxFor(2, {
      '1': makePayload(),
      '0': makePayload({state: PayloadState.Executed}),
    });
    const out = await scanExecutionChain(ctx);
    expect(out.length).toBe(1);
    expect(out[0]?.payloadId).toBe(1n);
  });

  test('skips non-Queued early without calling check', async () => {
    const ctx = ctxFor(1, {'0': makePayload({state: PayloadState.Executed})});
    expect(await scanExecutionChain(ctx)).toEqual([]);
  });

  test('skipCount > MAX_SKIP terminates the scan', async () => {
    const finals: Record<string, ReturnType<typeof makePayload>> = {};
    for (let i = 0; i < 22; i++) {
      finals[String(i)] = makePayload({state: PayloadState.Executed});
    }
    const ctx = ctxFor(22, finals);
    expect(await scanExecutionChain(ctx)).toEqual([]);
  });

  test('caps at MAX_EXECUTION_ACTIONS = 5', async () => {
    const byId: Record<string, ReturnType<typeof makePayload>> = {};
    for (let i = 0; i < 10; i++) byId[String(i)] = makePayload();
    const ctx = ctxFor(10, byId);
    const out = await scanExecutionChain(ctx);
    expect(out.length).toBe(MAX_EXECUTION_ACTIONS);
    expect(MAX_EXECUTION_SKIP).toBe(20);
  });

  test('rejects payloads still in their delay window', async () => {
    const ctx = ctxFor(1, {
      '0': makePayload({queuedAt: now(), delay: 100_000}),
    });
    expect(await scanExecutionChain(ctx)).toEqual([]);
  });

  test('throws when chainId has no PayloadsController configured', async () => {
    const ctx = {
      chainId: 0xdeadbeef,
      logger: silentLogger,
      publicClient: makeMockClient({}),
    };
    await expect(scanExecutionChain(ctx)).rejects.toThrow(/no PayloadsController/);
  });
});

describe('runExecutionScan', () => {
  test('happy path executes the payload via PayloadsController', async () => {
    const spy = makeWalletSpy(TX);
    const ctx = {
      ...ctxFor(1, {'0': makePayload()}),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const out = await runExecutionScan(ctx);
    expect(out.length).toBe(1);
    expect(out[0]?.txHash).toBe(TX);
    expect(spy.calls[0]?.functionName).toBe('executePayload');
  });

  test('records error when execute throws', async () => {
    const spy = makeWalletSpy(TX);
    spy.shouldThrow = new Error('rpc unavailable');
    const ctx = {
      ...ctxFor(1, {'0': makePayload()}),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const out = await runExecutionScan(ctx);
    expect(out[0]?.txHash).toBeUndefined();
    expect(out[0]?.error).toContain('rpc unavailable');
  });

  test('records recheck-fail when state changes between scan and execute', async () => {
    let reads = 0;
    const spy = makeWalletSpy(TX);
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        {
          [`${PC}.getPayloadsCount`]: 1,
          [`${PC}.getPayloadById`]: () => {
            reads += 1;
            // The scan reads the payload via multicall (1) + check via readContract (2);
            // recheck before execute is the 3rd read.
            return reads <= 2 ? makePayload() : makePayload({state: PayloadState.Executed});
          },
        },
        {chainId: 137},
      ),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
    };
    const out = await runExecutionScan(ctx);
    expect(out[0]?.txHash).toBeUndefined();
    expect(out[0]?.error).toBeDefined();
    expect(spy.calls.length).toBe(0);
  });
});
