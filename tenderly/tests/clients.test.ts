import {describe, expect, test} from 'bun:test';
import {
  __resetClientCaches,
  accountFromPrivateKey,
  candidateUrls,
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

describe('candidateUrls (mainnet fallback ordering)', () => {
  const PUBLICNODE = 'https://ethereum-rpc.publicnode.com';
  const MERKLE = 'https://eth.merkle.io'; // viem's mainnet default — 401s in practice

  test('Alchemy is primary when the key is set, curated publics follow', async () => {
    await withEnv({ALCHEMY_API_KEY: 'k1', RPC_MAINNET: undefined}, () => {
      const urls = candidateUrls(1);
      expect(urls[0]).toContain('alchemy');
      expect(urls).toContain(PUBLICNODE);
    });
  });

  test('reliable public RPCs come BEFORE viem default (merkle) — the bug fix', async () => {
    await withEnv({ALCHEMY_API_KEY: undefined, RPC_MAINNET: undefined}, () => {
      const urls = candidateUrls(1);
      expect(urls).toContain(PUBLICNODE);
      // merkle is only ever a last resort, never ahead of a curated provider.
      if (urls.includes(MERKLE)) {
        expect(urls.indexOf(PUBLICNODE)).toBeLessThan(urls.indexOf(MERKLE));
      }
      expect(urls[0]).not.toBe(MERKLE);
    });
  });

  test('an RPC_<NETWORK> override wins, with Alchemy kept as a backup', async () => {
    await withEnv({ALCHEMY_API_KEY: 'k1', RPC_MAINNET: 'https://my.node/rpc'}, () => {
      const urls = candidateUrls(1);
      expect(urls[0]).toBe('https://my.node/rpc');
      expect(urls.some((u) => u.includes('alchemy'))).toBe(true);
      expect(urls).toContain(PUBLICNODE);
    });
  });

  test('list is de-duplicated', async () => {
    await withEnv({ALCHEMY_API_KEY: 'k1', RPC_MAINNET: undefined}, () => {
      const urls = candidateUrls(1);
      expect(new Set(urls).size).toBe(urls.length);
    });
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
