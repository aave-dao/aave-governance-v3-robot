import {describe, expect, test} from 'bun:test';
import {
  __resetClientCaches,
  accountFromPrivateKey,
  describeRpcSource,
  getPublicClient,
} from '../src/core/clients';
import {withEnv} from './helpers/env';

describe('accountFromPrivateKey', () => {
  test('returns a deterministic 0x-address for a known private key', () => {
    const pk = ('0x' + '11'.repeat(32)) as `0x${string}`;
    const addr = accountFromPrivateKey(pk);
    // Known viem-derived address for keccak256-of-0x11..11 secp256k1 pubkey.
    expect(addr).toBe('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A');
  });

  test('different keys produce different addresses', () => {
    const a = accountFromPrivateKey(('0x' + '11'.repeat(32)) as `0x${string}`);
    const b = accountFromPrivateKey(('0x' + '22'.repeat(32)) as `0x${string}`);
    expect(a).not.toBe(b);
  });
});

describe('describeRpcSource', () => {
  test('returns "alchemy" when URL contains alchemy', () => {
    expect(describeRpcSource(1, 'https://eth-mainnet.g.alchemy.com/v2/abc')).toBe('alchemy');
  });

  test('returns "env RPC_<NAME>" when matching env var is set', async () => {
    const url = 'https://example.com/rpc';
    await withEnv({RPC_MAINNET: url}, () => {
      expect(describeRpcSource(1, url)).toBe('env RPC_MAINNET');
    });
  });

  test('returns "public/fallback" otherwise', async () => {
    await withEnv({RPC_MAINNET: undefined, ALCHEMY_API_KEY: undefined}, () => {
      expect(describeRpcSource(1, 'https://cloudflare-eth.com')).toBe('public/fallback');
    });
  });

  test('handles unknown chains without throwing', () => {
    expect(describeRpcSource(0xdeadbeef, 'https://random/rpc')).toBe('public/fallback');
  });
});

describe('__resetClientCaches', () => {
  test('caches getPublicClient by chainId within a session', async () => {
    await withEnv({ALCHEMY_API_KEY: 'k1'}, () => {
      __resetClientCaches();
      const a = getPublicClient(1);
      const b = getPublicClient(1);
      expect(a).toBe(b);
    });
  });

  test('reset + re-fetch does not throw', async () => {
    await withEnv({ALCHEMY_API_KEY: 'k1'}, () => {
      __resetClientCaches();
      getPublicClient(1);
      __resetClientCaches();
      // Re-fetch after reset must succeed — even if the underlying toolbox dedupes the
      // transport, our cache reset shouldn't break the lookup.
      expect(() => getPublicClient(1)).not.toThrow();
    });
  });
});
