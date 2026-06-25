import {decodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient} from 'viem';
import {multicall3Abi} from '../../src/core/abis';
import type {Logger} from '../../src/core/logger';

/**
 * Tiny mock for PublicClient.readContract — looks up by `${address}.${functionName}` and returns
 * either a static value or a function that takes args and returns a value (for state-dependent
 * mocks). This is enough to drive every action's `check()` predicate without spinning up a node.
 *
 * `chainState` carries non-contract reads (balance, gas price) keyed by chainId.
 */
export type Mocks = Record<string, unknown | ((args: readonly unknown[]) => unknown)>;

export type ChainState = {
  balance?: bigint;
  gasPrice?: bigint;
};

export type MockClientOptions = {
  chainId?: number;
  chainState?: ChainState;
};

export const makeMockClient = (
  mocks: Mocks,
  options: MockClientOptions = {},
): PublicClient => {
  const lookup = (address: string, functionName: string, args?: readonly unknown[]) => {
    const key = `${address.toLowerCase()}.${functionName}`;
    if (!(key in mocks)) throw new Error(`unmocked call: ${key}`);
    const v = mocks[key];
    return typeof v === 'function' ? (v as (a: readonly unknown[]) => unknown)(args ?? []) : v;
  };

  return {
    chain: options.chainId !== undefined ? {id: options.chainId} : undefined,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readContract: async ({address, functionName, args}: any) =>
      lookup(address as string, functionName, args),

    /**
     * Mock multicall — answers each contract entry from the same `mocks` table. The actions
     * batch reads via this; tests don't need to know the call shape.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    multicall: async ({contracts, allowFailure}: any) => {
      const results = contracts.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({address, functionName, args}: any) => {
          try {
            const result = lookup(address as string, functionName, args);
            return allowFailure === false ? result : {status: 'success', result};
          } catch (err) {
            if (allowFailure === false) throw err;
            return {status: 'failure', error: err};
          }
        },
      );
      return results;
    },

    /**
     * `simulateContract` is used by the storage-roots flow with `aggregate3(allowFailure:true)`.
     * For aggregate3, decode the inner Call3s, re-encode each as a `${target}.<resolved>` lookup
     * via the per-test `simulateAggregateOverrides` table (see `setSimulateOverrides` below).
     * For everything else, fall back to `lookup` so tests can stub direct simulateContract calls
     * with a `${addr}.${fn}.simulate` key.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulateContract: async ({address, functionName, args}: any) => {
      const simKey = `${(address as string).toLowerCase()}.${functionName}.simulate`;
      if (simKey in mocks) {
        const v = mocks[simKey];
        const result =
          typeof v === 'function'
            ? (v as (a: readonly unknown[]) => unknown)(args ?? [])
            : v;
        return {result};
      }
      // No simulate-specific mock; just pass through to readContract semantics.
      const result = lookup(address as string, functionName, args);
      return {result};
    },

    getBalance: async (_args?: {address: Address}) => {
      if (options.chainState?.balance === undefined) {
        throw new Error('getBalance not stubbed for this client');
      }
      return options.chainState.balance;
    },

    getGasPrice: async () => {
      if (options.chainState?.gasPrice === undefined) {
        throw new Error('getGasPrice not stubbed for this client');
      }
      return options.chainState.gasPrice;
    },

    /**
     * `notifyTxSuccess` waits for the receipt before posting. Tests don't actually broadcast,
     * so return a synthetic confirmed receipt — letting every action's "send tx → notify"
     * path complete deterministically. Override per-test by replacing the method on the
     * returned client if you need a `reverted` or timeout case.
     */
    waitForTransactionReceipt: async () => ({
      status: 'success' as const,
      blockNumber: 1n,
      logs: [],
    }),

    /**
     * `estimateContractGas` — used by `gas.ts → estimateGasWithMargin` before every
     * writeContract. Tests don't care about the precise value; return a small constant
     * (50k) so the multiplier yields a stable, easily-asserted value.
     */
    estimateContractGas: async () => 50_000n,

    /**
     * `getBlock({blockTag: 'latest'})` — used by `gas.ts → fetchBlockGasLimit` to read
     * the network's current block gas limit so we can cap our `writeContract` gas. 30M
     * is a sensible default (~mainnet 2024). The cap kicks in for txs where the
     * estimate * 1.5 > 0.95 * 30M ≈ 28.5M; the small 50k estimate above stays well
     * under the cap so tests still see the margined value.
     */
    getBlock: async () => ({
      gasLimit: 30_000_000n,
    }),
  } as unknown as PublicClient;
};

export const silentLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};

// ---------------- Wallet client mock --------------------------------------------------

export type WalletWriteCall = {
  address: string;
  functionName: string;
  args: readonly unknown[];
};

export type WalletSpy = {
  calls: WalletWriteCall[];
  txHash: Hex;
  shouldThrow?: Error;
};

export const makeWalletSpy = (
  txHash: Hex = ('0x' + 'ab'.repeat(32)) as Hex,
): WalletSpy => ({calls: [], txHash});

export const makeMockWalletClient = (
  spy: WalletSpy,
  opts: {chainId: number; account: Address},
): WalletClient => {
  const account = {address: opts.account, type: 'json-rpc'} as const;
  const chain = {id: opts.chainId, name: `chain-${opts.chainId}`} as const;
  return {
    account,
    chain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writeContract: async ({address, functionName, args}: any) => {
      if (spy.shouldThrow) throw spy.shouldThrow;
      spy.calls.push({address: String(address), functionName, args});
      return spy.txHash;
    },
  } as unknown as WalletClient;
};

/**
 * Helper: decode a multicall3 aggregate3 calldata blob back to its inner Call3 array. Useful
 * in submitStorageRoots tests for asserting the right number of inner calls.
 */
export const decodeAggregate3 = (calldata: Hex) => {
  const decoded = decodeFunctionData({abi: multicall3Abi, data: calldata});
  if (decoded.functionName !== 'aggregate3') {
    throw new Error(`expected aggregate3, got ${decoded.functionName}`);
  }
  return decoded.args[0] as ReadonlyArray<{target: Address; allowFailure: boolean; callData: Hex}>;
};
