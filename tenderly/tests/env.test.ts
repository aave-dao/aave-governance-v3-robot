import {describe, expect, test} from 'bun:test';
import {loadEnv, requirePrivateKey} from '../src/cli/env';
import {withEnv} from './helpers/env';

describe('loadEnv', () => {
  test('throws when no RPC source is configured', async () => {
    await withEnv(
      {ALCHEMY_API_KEY: undefined, RPC_MAINNET: undefined, RPC_POLYGON: undefined},
      async () => {
        // Strip any leftover RPC_* keys from the host environment.
        const stripped: Record<string, string | undefined> = {};
        for (const k of Object.keys(process.env)) {
          if (k.startsWith('RPC_')) stripped[k] = undefined;
        }
        await withEnv(stripped, () => {
          expect(() => loadEnv()).toThrow('No RPC source configured');
        });
      },
    );
  });

  test('succeeds with ALCHEMY_API_KEY only and defaults LOG_LEVEL=info', async () => {
    await withEnv({ALCHEMY_API_KEY: 'test-key', PRIVATE_KEY: undefined}, () => {
      const env = loadEnv();
      expect(env.ALCHEMY_API_KEY).toBe('test-key');
      expect(env.LOG_LEVEL).toBe('info');
    });
  });

  test('succeeds with RPC_<NETWORK> only', async () => {
    await withEnv(
      {ALCHEMY_API_KEY: undefined, RPC_MAINNET: 'https://example.com', PRIVATE_KEY: undefined},
      () => {
        const env = loadEnv();
        expect(env.LOG_LEVEL).toBe('info');
      },
    );
  });

  test('rejects malformed PRIVATE_KEY', async () => {
    await withEnv(
      {ALCHEMY_API_KEY: 'test-key', PRIVATE_KEY: 'not-a-key'},
      () => {
        expect(() => loadEnv()).toThrow(/PRIVATE_KEY/);
      },
    );
  });

  test('rejects unknown LOG_LEVEL', async () => {
    await withEnv(
      {ALCHEMY_API_KEY: 'test-key', LOG_LEVEL: 'banana', PRIVATE_KEY: undefined},
      () => {
        expect(() => loadEnv()).toThrow(/LOG_LEVEL/);
      },
    );
  });

  test('accepts a well-formed PRIVATE_KEY', async () => {
    const pk = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    await withEnv(
      {ALCHEMY_API_KEY: 'test-key', PRIVATE_KEY: pk},
      () => {
        const env = loadEnv();
        expect(env.PRIVATE_KEY).toBe(pk);
      },
    );
  });
});

describe('requirePrivateKey', () => {
  test('throws when PRIVATE_KEY is missing', () => {
    expect(() => requirePrivateKey({LOG_LEVEL: 'info'} as never)).toThrow(/PRIVATE_KEY/);
  });

  test('returns the key when present', () => {
    const pk = ('0x' + '11'.repeat(32)) as `0x${string}`;
    expect(requirePrivateKey({LOG_LEVEL: 'info', PRIVATE_KEY: pk} as never)).toBe(pk);
  });
});
