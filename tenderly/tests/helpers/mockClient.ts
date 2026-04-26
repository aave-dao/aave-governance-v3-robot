import type {PublicClient} from 'viem';
import type {Logger} from '../../src/core/logger';

/**
 * Tiny mock for PublicClient.readContract — looks up by `${address}.${functionName}` and returns
 * either a static value or a function that takes args and returns a value (for state-dependent
 * mocks). This is enough to drive every action's `check()` predicate without spinning up a node.
 */
export type Mocks = Record<string, unknown | ((args: readonly unknown[]) => unknown)>;

export const makeMockClient = (mocks: Mocks): PublicClient => {
  const lookup = (address: string, functionName: string, args?: readonly unknown[]) => {
    const key = `${address.toLowerCase()}.${functionName}`;
    if (!(key in mocks)) throw new Error(`unmocked call: ${key}`);
    const v = mocks[key];
    return typeof v === 'function' ? (v as (a: readonly unknown[]) => unknown)(args ?? []) : v;
  };

  return {
    readContract: async ({address, functionName, args}: any) =>
      lookup(address as string, functionName, args),

    /**
     * Mock multicall — answers each contract entry from the same `mocks` table. The actions
     * batch reads via this; tests don't need to know the call shape.
     */
    multicall: async ({contracts, allowFailure}: any) => {
      const results = contracts.map(({address, functionName, args}: any) => {
        try {
          const result = lookup(address as string, functionName, args);
          return allowFailure === false ? result : {status: 'success', result};
        } catch (err) {
          if (allowFailure === false) throw err;
          return {status: 'failure', error: err};
        }
      });
      return results;
    },
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
