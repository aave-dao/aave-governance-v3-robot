import {beforeAll, afterAll, describe, expect, mock, test} from 'bun:test';
import type {Address, Hex} from 'viem';
import {silentLogger} from './helpers/mockClient';

// Stub the clients module BEFORE importing health, so collectHealth's getPublicClient call
// hits our fake. Each call returns a per-chain mock with controllable balance + gasPrice.
type ChainStub = {balance?: bigint; gasPrice?: bigint; throwOnBalance?: boolean};
const stubs = new Map<number, ChainStub>();

await mock.module('../src/core/clients', () => ({
  getPublicClient: (chainId: number) => {
    const s = stubs.get(chainId) ?? {};
    return {
      getBalance: async () => {
        if (s.throwOnBalance) throw new Error('rpc down');
        return s.balance ?? 0n;
      },
      getGasPrice: async () => s.gasPrice ?? 0n,
    };
  },
  accountFromPrivateKey: () => ('0x' + '11'.repeat(20)) as Address,
  // Other exports collectHealth doesn't use:
  __resetClientCaches: () => {},
  describeRpcSource: () => 'mock',
  getRpcUrl: () => 'mock://',
  getWalletClient: () => ({}),
}));

// Now safe to import the health module — its getPublicClient binding points at our mock.
const {collectHealth, formatHealthAlert, formatHealthReport} = await import('../src/cli/health');

const PK = ('0x' + '11'.repeat(32)) as Hex;

const ORIGINAL_ENV = {...process.env};
beforeAll(() => {
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
});
afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL_ENV)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

const setStub = (chainId: number, stub: ChainStub) => stubs.set(chainId, stub);
const clearStubs = () => stubs.clear();

describe('collectHealth', () => {
  test('produces one row per unique chain (gov+voting+exec dedupe)', async () => {
    clearStubs();
    // Cheap, healthy stubs for every chain.
    const cheap: ChainStub = {balance: 10n ** 30n, gasPrice: 1n};
    for (let i = 0; i < 100_000; i++) setStub(i, cheap);
    const rows = await collectHealth(PK, silentLogger, {minRounds: 10});
    const ids = rows.map((r) => r.chainId);
    expect(new Set(ids).size).toBe(ids.length); // every chainId appears at most once
    // ethereum (1) appears as gov + voting + exec — verify it shows up exactly once.
    expect(ids.filter((id) => id === 1).length).toBe(1);
  });

  test('ok when balance covers many rounds', async () => {
    clearStubs();
    setStub(1, {balance: 10n ** 30n, gasPrice: 1n}); // huge balance, tiny gas
    setStub(137, {balance: 10n ** 30n, gasPrice: 1n});
    setStub(43114, {balance: 10n ** 30n, gasPrice: 1n});
    // Provide cheap defaults for every other configured chain so they don't error out.
    const cheap = {balance: 10n ** 30n, gasPrice: 1n};
    for (const id of [42161, 10, 8453, 56, 100, 1088, 534352, 42220, 59144, 5000, 57073, 9745, 4326, 1868, 146, 196, 324]) {
      setStub(id, cheap);
    }
    const rows = await collectHealth(PK, silentLogger, {minRounds: 10});
    const eth = rows.find((r) => r.chainId === 1);
    expect(eth?.status).toBe('ok');
    expect(eth?.rounds).toBeGreaterThan(10);
  });

  test('warn when rounds < minRounds but >= minRounds/4', async () => {
    clearStubs();
    // Gas units for ethereum: 300_000+500_000+200_000 (gov) + 3_000_000+200_000+400_000 (voting) + 2_500_000 (exec)
    // = 7_100_000. Pick balance / gas so that rounds = 5 (when minRounds=10, that's warn).
    // gasPrice * gasPerRound = costPerRound; balance / costPerRound = 5.
    // gasPrice = 1n: costPerRound = 7_100_000n, balance = 5 * 7_100_000n = 35_500_000n.
    setStub(1, {balance: 35_500_000n, gasPrice: 1n});
    // Healthy defaults elsewhere so the rest don't dominate.
    const cheap = {balance: 10n ** 30n, gasPrice: 1n};
    for (const id of [137, 43114, 42161, 10, 8453, 56, 100, 1088, 534352, 42220, 59144, 5000, 57073, 9745, 4326, 1868, 146, 196, 324]) {
      setStub(id, cheap);
    }
    const rows = await collectHealth(PK, silentLogger, {minRounds: 10});
    const eth = rows.find((r) => r.chainId === 1);
    expect(eth?.status).toBe('warn');
  });

  test('critical when rounds < minRounds/4', async () => {
    clearStubs();
    setStub(1, {balance: 7_100_000n, gasPrice: 1n}); // 1 round
    const cheap = {balance: 10n ** 30n, gasPrice: 1n};
    for (const id of [137, 43114, 42161, 10, 8453, 56, 100, 1088, 534352, 42220, 59144, 5000, 57073, 9745, 4326, 1868, 146, 196, 324]) {
      setStub(id, cheap);
    }
    const rows = await collectHealth(PK, silentLogger, {minRounds: 100});
    const eth = rows.find((r) => r.chainId === 1);
    expect(eth?.status).toBe('critical');
  });

  test('error when getBalance throws', async () => {
    clearStubs();
    setStub(1, {throwOnBalance: true});
    const cheap = {balance: 10n ** 30n, gasPrice: 1n};
    for (const id of [137, 43114, 42161, 10, 8453, 56, 100, 1088, 534352, 42220, 59144, 5000, 57073, 9745, 4326, 1868, 146, 196, 324]) {
      setStub(id, cheap);
    }
    const rows = await collectHealth(PK, silentLogger, {minRounds: 10});
    const eth = rows.find((r) => r.chainId === 1);
    expect(eth?.status).toBe('error');
    expect(eth?.error).toContain('rpc down');
  });

  test('govchain (1) has gov+voting+exec actions; pure exec chain (42161) has only exec', async () => {
    clearStubs();
    const cheap = {balance: 10n ** 30n, gasPrice: 1n};
    for (let i = 0; i < 100_000; i++) setStub(i, cheap);
    const rows = await collectHealth(PK, silentLogger, {minRounds: 10});
    const eth = rows.find((r) => r.chainId === 1);
    const arb = rows.find((r) => r.chainId === 42161);
    // gov has activateVoting+executeProposal+cancelProposal, voting has 3 more, exec has 1 more.
    expect((eth?.actions ?? []).map((a) => a.name)).toEqual([
      'activateVoting',
      'executeProposal',
      'cancelProposal',
      'submitStorageRoots',
      'createVote',
      'closeAndSendVote',
      'executePayload',
    ]);
    expect((arb?.actions ?? []).map((a) => a.name)).toEqual(['executePayload']);
  });
});

describe('formatHealthAlert', () => {
  const baseRow = {
    chainId: 1,
    name: 'ethereum',
    account: ('0x' + '00'.repeat(20)) as Address,
    nativeSymbol: 'ETH',
    balanceWei: 10n ** 18n,
    gasPriceWei: 1_000_000_000n,
    actions: [],
    roundCostWei: 10n ** 17n,
    rounds: 10,
  };

  test('returns null when every chain is ok', () => {
    expect(
      formatHealthAlert([{...baseRow, status: 'ok'}], {minRounds: 10}),
    ).toBeNull();
  });

  test('renders three flavors when at least one chain is below threshold', () => {
    const out = formatHealthAlert([{...baseRow, status: 'warn'}], {minRounds: 10});
    expect(out).not.toBeNull();
    expect(out?.slack).toContain(':rotating_light:');
    expect(out?.slack).toContain('ethereum');
    expect(out?.tg).toContain('🚨');
    expect(out?.tg).toContain('<b>signer balance alert</b>');
    expect(out?.plain).toContain('🚨');
    expect(out?.plain).not.toContain('<b>');
    expect(out?.plain).not.toContain(':rotating_light:');
  });

  test('error rows include the probe failure reason', () => {
    const out = formatHealthAlert(
      [{...baseRow, status: 'error', error: 'rpc 500'}],
      {minRounds: 10},
    );
    expect(out?.slack).toContain('rpc 500');
    expect(out?.plain).toContain('rpc 500');
  });

  test('HTML-escapes special characters in the chain name in the TG flavor', () => {
    const out = formatHealthAlert(
      [{...baseRow, name: '<malicious>&', status: 'critical'}],
      {minRounds: 10},
    );
    expect(out?.tg).toContain('&lt;malicious&gt;&amp;');
    // Plain text shows the raw name; that's intended (it's not HTML).
    expect(out?.plain).toContain('<malicious>&');
  });
});

describe('formatHealthReport', () => {
  const row = {
    chainId: 1,
    name: 'ethereum',
    account: ('0x' + '00'.repeat(20)) as Address,
    nativeSymbol: 'ETH',
    balanceWei: 10n ** 18n,
    gasPriceWei: 1_000_000_000n,
    actions: [{name: 'activateVoting', gasUnits: 300_000n, costWei: 300_000n * 1_000_000_000n}],
    roundCostWei: 300_000n * 1_000_000_000n,
    rounds: 100,
    status: 'ok' as const,
  };

  test('contains a banner and the rounds-remaining line', () => {
    const out = formatHealthReport([row], {minRounds: 10});
    expect(out).toContain('Health check for');
    expect(out).toContain('ethereum');
    expect(out).toContain('rounds remaining');
    expect(out).toContain('all chains healthy');
  });

  test('summary lists chains below threshold', () => {
    const warn = {...row, status: 'warn' as const, rounds: 1};
    const out = formatHealthReport([warn], {minRounds: 10});
    expect(out).toContain('1 chain below threshold');
    expect(out).toContain('ethereum');
    expect(out).not.toContain('all chains healthy');
  });

  test('summary lists chains that errored', () => {
    const errRow = {...row, status: 'error' as const, error: 'rpc 500', actions: []};
    const out = formatHealthReport([errRow], {minRounds: 10});
    expect(out).toContain('failed to probe');
    expect(out).toContain('rpc 500');
    expect(out).toContain('1 chain could not be probed');
  });
});
