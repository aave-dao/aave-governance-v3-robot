import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {GovernanceV3Polygon} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {MULTICALL3_ADDRESS} from '../src/core/abis';
import {
  buildStorageRootCalls,
  buildStorageRootEntries,
  executeSubmitStorageRoots,
  submitStorageRootsForBlock,
} from '../src/core/actions/submitStorageRoots';
import {GOVERNANCE_TOKENS, VOTING_CHAINS} from '../src/core/chains';
import {makeMockClient, makeMockWalletClient, makeWalletSpy, silentLogger} from './helpers/mockClient';
import {installFetchMock, type FetchResponseSpec} from './helpers/mockFetch';
import {mockBlock} from './helpers/fixtures';

const ETH_RPC = 'https://l1.example.com';
const BLOCK_HASH = ('0x' + 'aa'.repeat(32)) as Hex;
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ACCOUNT = ('0x' + '99'.repeat(20)) as Address;
const TX = ('0x' + 'cc'.repeat(32)) as Hex;
const POL = VOTING_CHAINS[137]!;
const WAREHOUSE = POL.dataWarehouse.toLowerCase();
const MC3 = MULTICALL3_ADDRESS.toLowerCase();

// ---------- shared L1-RPC mock builder ----------

type GetProofResult = {
  storageHash: Hex;
  accountProof: Hex[];
  storageProof: {key: Hex; value: Hex; proof: Hex[]}[];
};

const proof = (storageHash: Hex, slotValue?: Hex): GetProofResult => ({
  storageHash,
  accountProof: ['0x80', '0xc0'] as Hex[],
  storageProof:
    slotValue !== undefined
      ? [{key: ('0x' + '00'.repeat(32)) as Hex, value: slotValue, proof: ['0x80'] as Hex[]}]
      : [],
});

const aaveRoot = ('0x' + '11'.repeat(32)) as Hex;
const aAaveRoot = ('0x' + '22'.repeat(32)) as Hex;
const stkAaveRoot = ('0x' + '33'.repeat(32)) as Hex;
const govRoot = ('0x' + '44'.repeat(32)) as Hex;
const stkSlotValue = '0x0a' as Hex;

const installL1RpcMock = () =>
  installFetchMock((_url, init): FetchResponseSpec => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const ok = (result: unknown) => ({
      status: 200,
      body: JSON.stringify({jsonrpc: '2.0', id: body.id ?? 1, result}),
    });
    if (body.method === 'eth_getBlockByHash') return ok(mockBlock);
    if (body.method === 'eth_getProof') {
      const [account] = body.params as [Address, Hex[], Hex];
      const a = account.toLowerCase();
      if (a === GOVERNANCE_TOKENS.aave.toLowerCase()) return ok(proof(aaveRoot));
      if (a === GOVERNANCE_TOKENS.aAave.toLowerCase()) return ok(proof(aAaveRoot));
      if (a === GOVERNANCE_TOKENS.stkAave.toLowerCase()) {
        return ok(proof(stkAaveRoot, stkSlotValue));
      }
      if (a === POL.governance.toLowerCase()) return ok(proof(govRoot));
    }
    throw new Error(`unexpected RPC method: ${body.method}`);
  });

// ---------- mute notifications ----------

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

// ---------- buildStorageRootEntries ----------

describe('buildStorageRootEntries', () => {
  test('returns 4 root entries + 1 slot entry, in the documented order', async () => {
    const {restore} = installL1RpcMock();
    try {
      const entries = await buildStorageRootEntries(ETH_RPC, POL, BLOCK_HASH, silentLogger);
      expect(entries.length).toBe(5);
      expect(entries[0]?.kind).toBe('root');
      expect(entries[0]?.account.toLowerCase()).toBe(GOVERNANCE_TOKENS.aave.toLowerCase());
      expect(entries[1]?.account.toLowerCase()).toBe(GOVERNANCE_TOKENS.aAave.toLowerCase());
      expect(entries[2]?.account.toLowerCase()).toBe(GOVERNANCE_TOKENS.stkAave.toLowerCase());
      expect(entries[3]?.account.toLowerCase()).toBe(POL.governance.toLowerCase());
      expect(entries[4]?.kind).toBe('slot');
    } finally {
      restore();
    }
  });

  test('throws when stkAAVE proof has no storageProof entry', async () => {
    const {restore} = installFetchMock((_url, init): FetchResponseSpec => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const ok = (r: unknown) => ({status: 200, body: JSON.stringify({jsonrpc: '2.0', id: 1, result: r})});
      if (body.method === 'eth_getBlockByHash') return ok(mockBlock);
      if (body.method === 'eth_getProof') {
        const [account] = body.params as [Address, Hex[], Hex];
        if (account.toLowerCase() === GOVERNANCE_TOKENS.stkAave.toLowerCase()) {
          // missing storageProof[0]
          return ok({...proof(stkAaveRoot), storageProof: []});
        }
        return ok(proof(('0x' + '00'.repeat(32)) as Hex));
      }
      throw new Error('unexpected');
    });
    try {
      await expect(
        buildStorageRootEntries(ETH_RPC, POL, BLOCK_HASH, silentLogger),
      ).rejects.toThrow(/stkAAVE storage proof/);
    } finally {
      restore();
    }
  });

  test('throws when block is missing a number', async () => {
    const {restore} = installFetchMock((_url, init): FetchResponseSpec => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const ok = (r: unknown) => ({status: 200, body: JSON.stringify({jsonrpc: '2.0', id: 1, result: r})});
      if (body.method === 'eth_getBlockByHash') return ok(null);
      return ok(null);
    });
    try {
      await expect(
        buildStorageRootEntries(ETH_RPC, POL, BLOCK_HASH, silentLogger),
      ).rejects.toThrow(/not found via eth_getBlockByHash/);
    } finally {
      restore();
    }
  });
});

describe('buildStorageRootCalls (back-compat shim)', () => {
  test('returns 5 Call3 entries', async () => {
    const {restore} = installL1RpcMock();
    try {
      const calls = await buildStorageRootCalls(ETH_RPC, POL, BLOCK_HASH, silentLogger);
      expect(calls.length).toBe(5);
      for (const c of calls) {
        expect(c.allowFailure).toBe(false);
        expect(c.target.toLowerCase()).toBe(WAREHOUSE);
      }
    } finally {
      restore();
    }
  });
});

// ---------- planBatch / executeSubmitStorageRoots ----------

const allRegisteredMocks = () => ({
  // root reads: getStorageRoots(account, blockHash)
  [`${WAREHOUSE}.getStorageRoots`]: (args: readonly unknown[]) => {
    const account = String(args[0]).toLowerCase();
    if (account === GOVERNANCE_TOKENS.aave.toLowerCase()) return aaveRoot;
    if (account === GOVERNANCE_TOKENS.aAave.toLowerCase()) return aAaveRoot;
    if (account === GOVERNANCE_TOKENS.stkAave.toLowerCase()) return stkAaveRoot;
    if (account === POL.governance.toLowerCase()) return govRoot;
    return ZERO;
  },
  // slot read: getRegisteredSlot(blockHash, account, slot) → bigint
  [`${WAREHOUSE}.getRegisteredSlot`]: BigInt(stkSlotValue),
});

const noneRegisteredMocks = () => ({
  [`${WAREHOUSE}.getStorageRoots`]: ZERO,
  [`${WAREHOUSE}.getRegisteredSlot`]: 0n,
});

const allSucceedSimulate = (size: number) => ({
  [`${MC3}.aggregate3.simulate`]: Array.from({length: size}, () => ({
    success: true,
    returnData: '0x',
  })),
});

describe('executeSubmitStorageRoots', () => {
  test('throws when blockHash is ZERO (precheck failure)', async () => {
    const spy = makeWalletSpy(TX);
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient({}, {chainId: 137}),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
      ethRpcUrl: ETH_RPC,
    };
    await expect(
      executeSubmitStorageRoots(ctx, {
        proposalId: 1n,
        l1ProposalBlockHash: ZERO as Hex,
      }),
    ).rejects.toThrow(/no snapshot block hash/);
    expect(spy.calls.length).toBe(0);
  });

  test('skips when every entry already matches the warehouse', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(allRegisteredMocks(), {chainId: 137}),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      const out = await executeSubmitStorageRoots(ctx, {
        proposalId: 1n,
        l1ProposalBlockHash: BLOCK_HASH,
      });
      if ('skipped' in out) {
        expect(out.skipped).toContain('already registered');
      } else {
        throw new Error('expected skipped result');
      }
      expect(spy.calls.length).toBe(0);
    } finally {
      restore();
    }
  });

  test('throws on root mismatch (warehouse holds a different value)', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {
            [`${WAREHOUSE}.getStorageRoots`]: (args: readonly unknown[]) => {
              const a = String(args[0]).toLowerCase();
              // aAave's registered root differs from what we'd submit.
              if (a === GOVERNANCE_TOKENS.aAave.toLowerCase()) return ('0x' + 'ee'.repeat(32)) as Hex;
              if (a === GOVERNANCE_TOKENS.aave.toLowerCase()) return aaveRoot;
              if (a === GOVERNANCE_TOKENS.stkAave.toLowerCase()) return stkAaveRoot;
              if (a === POL.governance.toLowerCase()) return govRoot;
              return ZERO;
            },
            [`${WAREHOUSE}.getRegisteredSlot`]: BigInt(stkSlotValue),
          },
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      await expect(
        executeSubmitStorageRoots(ctx, {proposalId: 1n, l1ProposalBlockHash: BLOCK_HASH}),
      ).rejects.toThrow(/storage-root mismatch/);
      expect(spy.calls.length).toBe(0);
    } finally {
      restore();
    }
  });

  test('happy path: simulate clean → writes Multicall3.aggregate3 with 5 calls', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {...noneRegisteredMocks(), ...allSucceedSimulate(5)},
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      const out = await executeSubmitStorageRoots(ctx, {
        proposalId: 1n,
        l1ProposalBlockHash: BLOCK_HASH,
      });
      if ('txHash' in out && out.txHash) {
        expect(out.txHash).toBe(TX);
      } else {
        throw new Error('expected txHash');
      }
      expect(spy.calls.length).toBe(1);
      expect(spy.calls[0]?.address.toLowerCase()).toBe(MC3);
      expect(spy.calls[0]?.functionName).toBe('aggregate3');
      const innerCalls = spy.calls[0]?.args[0] as ReadonlyArray<{target: Address}>;
      expect(innerCalls.length).toBe(5);
    } finally {
      restore();
    }
  });

  test('partial existing roots: only the missing 3 are sent', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {
            [`${WAREHOUSE}.getStorageRoots`]: (args: readonly unknown[]) => {
              const a = String(args[0]).toLowerCase();
              if (a === GOVERNANCE_TOKENS.aave.toLowerCase()) return aaveRoot; // match
              if (a === POL.governance.toLowerCase()) return govRoot; // match
              return ZERO; // missing
            },
            [`${WAREHOUSE}.getRegisteredSlot`]: 0n, // missing
            ...allSucceedSimulate(3),
          },
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      await executeSubmitStorageRoots(ctx, {
        proposalId: 1n,
        l1ProposalBlockHash: BLOCK_HASH,
      });
      expect(spy.calls.length).toBe(1);
      const inner = spy.calls[0]?.args[0] as ReadonlyArray<unknown>;
      expect(inner.length).toBe(3);
    } finally {
      restore();
    }
  });

  test('preflight simulate revert → throws with the failing entry summary, no tx sent', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {
            ...noneRegisteredMocks(),
            // Two-call preflight: first succeeds, second fails with bare revert.
            [`${MC3}.aggregate3.simulate`]: [
              {success: true, returnData: '0x' as Hex},
              {success: false, returnData: '0x' as Hex},
              {success: true, returnData: '0x' as Hex},
              {success: true, returnData: '0x' as Hex},
              {success: true, returnData: '0x' as Hex},
            ],
          },
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      await expect(
        executeSubmitStorageRoots(ctx, {
          proposalId: 1n,
          l1ProposalBlockHash: BLOCK_HASH,
        }),
      ).rejects.toThrow(/pre-flight simulation/);
      expect(spy.calls.length).toBe(0);
    } finally {
      restore();
    }
  });

  test('every inner Call3 targets the polygon DataWarehouse with allowFailure=false', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {...noneRegisteredMocks(), ...allSucceedSimulate(5)},
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      await executeSubmitStorageRoots(ctx, {
        proposalId: 1n,
        l1ProposalBlockHash: BLOCK_HASH,
      });
      const inner = spy.calls[0]?.args[0] as ReadonlyArray<{
        target: Address;
        callData: Hex;
        allowFailure: boolean;
      }>;
      expect(inner.length).toBe(5);
      for (const c of inner) {
        expect(c.target.toLowerCase()).toBe(WAREHOUSE);
        expect(c.allowFailure).toBe(false);
      }
    } finally {
      restore();
    }
  });
});

// ---------- submitStorageRootsForBlock ----------

describe('submitStorageRootsForBlock', () => {
  test('happy path on an arbitrary block hash (no proposalId)', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(
          {...noneRegisteredMocks(), ...allSucceedSimulate(5)},
          {chainId: 137},
        ),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      const out = await submitStorageRootsForBlock(ctx, {
        l1BlockHash: BLOCK_HASH,
        config: POL,
      });
      if ('txHash' in out && out.txHash) expect(out.txHash).toBe(TX);
      else throw new Error('expected txHash');
      expect(spy.calls.length).toBe(1);
    } finally {
      restore();
    }
  });

  test('skips when warehouse already has every root', async () => {
    const {restore} = installL1RpcMock();
    try {
      const spy = makeWalletSpy(TX);
      const ctx = {
        chainId: 137,
        logger: silentLogger,
        publicClient: makeMockClient(allRegisteredMocks(), {chainId: 137}),
        walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
        account: ACCOUNT,
        ethRpcUrl: ETH_RPC,
      };
      const out = await submitStorageRootsForBlock(ctx, {
        l1BlockHash: BLOCK_HASH,
        config: POL,
      });
      if ('skipped' in out) expect(out.skipped).toContain('already registered');
      else throw new Error('expected skipped');
      expect(spy.calls.length).toBe(0);
    } finally {
      restore();
    }
  });
});
