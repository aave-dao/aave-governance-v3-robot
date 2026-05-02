import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {AaveV2Avalanche, AaveV3Avalanche, GovernanceV3Avalanche} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {
  checkProofOfReserves,
  proofOfReservesAction,
} from '../src/core/actions/proofOfReserves';
import {
  makeMockClient,
  makeMockWalletClient,
  makeWalletSpy,
  silentLogger,
  type Mocks,
} from './helpers/mockClient';

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

const CHAIN_ID = GovernanceV3Avalanche.CHAIN_ID;
const ACCOUNT = ('0x' + '99'.repeat(20)) as Address;
const TX = ('0x' + 'cd'.repeat(32)) as Hex;
const V2 = AaveV2Avalanche.PROOF_OF_RESERVE.toLowerCase() as Address;
const V3 = AaveV3Avalanche.PROOF_OF_RESERVE.toLowerCase() as Address;

const buildReadCtx = (mocks: Mocks) => ({
  chainId: CHAIN_ID,
  logger: silentLogger,
  publicClient: makeMockClient(mocks, {chainId: CHAIN_ID}),
});

const buildWriteCtx = (mocks: Mocks) => {
  const spy = makeWalletSpy(TX);
  return {
    spy,
    ctx: {
      chainId: CHAIN_ID,
      logger: silentLogger,
      publicClient: makeMockClient(mocks, {chainId: CHAIN_ID}),
      walletClient: makeMockWalletClient(spy, {chainId: CHAIN_ID, account: ACCOUNT}),
      account: ACCOUNT,
    },
  };
};

describe('checkProofOfReserves', () => {
  test('ok when not all backed AND emergency action possible (mirrors keeper checkUpkeep)', async () => {
    const ctx = buildReadCtx({
      [`${V3}.areAllReservesBacked`]: false,
      [`${V3}.isEmergencyActionPossible`]: true,
    });
    const result = await checkProofOfReserves(ctx, AaveV3Avalanche.PROOF_OF_RESERVE as Address);
    expect(result.ok).toBe(true);
  });

  test('skips when all reserves backed (keeper would return false)', async () => {
    const ctx = buildReadCtx({
      [`${V3}.areAllReservesBacked`]: true,
      [`${V3}.isEmergencyActionPossible`]: true,
    });
    const result = await checkProofOfReserves(ctx, AaveV3Avalanche.PROOF_OF_RESERVE as Address);
    expect(result).toEqual({ok: false, reason: 'all reserves backed'});
  });

  test('skips when emergency action not possible (loop guard hit)', async () => {
    const ctx = buildReadCtx({
      [`${V3}.areAllReservesBacked`]: false,
      [`${V3}.isEmergencyActionPossible`]: false,
    });
    const result = await checkProofOfReserves(ctx, AaveV3Avalanche.PROOF_OF_RESERVE as Address);
    expect(result).toEqual({
      ok: false,
      reason: 'emergency action already executed (loop guard)',
    });
  });

  test('rejects unregistered executor with a clear error', async () => {
    const ctx = buildReadCtx({});
    const stranger = ('0x' + 'aa'.repeat(20)) as Address;
    await expect(checkProofOfReserves(ctx, stranger)).rejects.toThrow(/not registered/);
  });
});

describe('proofOfReservesAction.execute', () => {
  test('calls executeEmergencyAction on the executor and returns txHash', async () => {
    const {spy, ctx} = buildWriteCtx({
      [`${V3}.areAllReservesBacked`]: false,
      [`${V3}.isEmergencyActionPossible`]: true,
    });
    const out = await proofOfReservesAction.execute(
      ctx,
      AaveV3Avalanche.PROOF_OF_RESERVE as Address,
    );
    expect(out.txHash).toBe(TX);
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(V3);
    expect(spy.calls[0]?.functionName).toBe('executeEmergencyAction');
    expect(spy.calls[0]?.args).toEqual([]);
  });

  test('refuses when precheck fails', async () => {
    const {ctx} = buildWriteCtx({
      [`${V2}.areAllReservesBacked`]: true,
      [`${V2}.isEmergencyActionPossible`]: true,
    });
    await expect(
      proofOfReservesAction.execute(ctx, AaveV2Avalanche.PROOF_OF_RESERVE as Address),
    ).rejects.toThrow(/precheck failed.*all reserves backed/);
  });
});
