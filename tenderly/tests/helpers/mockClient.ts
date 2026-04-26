import type { PublicClient } from 'viem';
import type { Logger } from '../../src/core/logger';

/**
 * Tiny mock for PublicClient.readContract — looks up by `${address}.${functionName}` and returns
 * either a static value or a function that takes args and returns a value (for state-dependent
 * mocks). This is enough to drive every action's `check()` predicate without spinning up a node.
 */
export type Mocks = Record<string, unknown | ((args: readonly unknown[]) => unknown)>;

export const makeMockClient = (mocks: Mocks): PublicClient => {
  return {
    readContract: async ({ address, functionName, args }: any) => {
      const key = `${(address as string).toLowerCase()}.${functionName}`;
      if (!(key in mocks)) throw new Error(`unmocked call: ${key}`);
      const v = mocks[key];
      return typeof v === 'function' ? (v as (a: readonly unknown[]) => unknown)(args ?? []) : v;
    },
  } as unknown as PublicClient;
};

export const silentLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() { return silentLogger; },
};
