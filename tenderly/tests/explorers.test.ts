import {describe, expect, test} from 'bun:test';
import {explorerBaseUrl, shortHash, txUrl} from '../src/core/explorers';

describe('explorerBaseUrl', () => {
  test('returns the viem-derived URL for chainId 1', () => {
    const url = explorerBaseUrl(1);
    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\/[a-z]+\.[a-z]+/);
    expect(url?.endsWith('/')).toBe(false);
  });

  test('returns viem-derived URL for chainId 137 (Polygon)', () => {
    expect(explorerBaseUrl(137)).toBeDefined();
  });

  test('returns a string (viem entry or hardcoded fallback) for chainId 4326 (MegaETH)', () => {
    // Either viem now ships an entry for it, or we fall through to FALLBACK_EXPLORERS.
    // Both are acceptable — the contract is "we know how to render a URL for this chain".
    const url = explorerBaseUrl(4326);
    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\//);
  });

  test('returns undefined for an unknown chainId', () => {
    expect(explorerBaseUrl(0xdeadbeef)).toBeUndefined();
  });
});

describe('txUrl', () => {
  test('builds a tx URL on the right explorer', () => {
    const url = txUrl(1, '0xabc');
    expect(url).toBeDefined();
    expect(url).toContain('/tx/0xabc');
  });

  test('returns undefined when no explorer is known', () => {
    expect(txUrl(0xdeadbeef, '0xabc')).toBeUndefined();
  });
});

describe('shortHash', () => {
  test('truncates a 66-char hash to first6…last4', () => {
    const hash = '0x' + 'ab'.repeat(32);
    const short = shortHash(hash);
    expect(short).toBe(`${hash.slice(0, 6)}…${hash.slice(-4)}`);
    expect(short.length).toBe(6 + 1 + 4);
  });

  test('leaves short strings unchanged', () => {
    expect(shortHash('0xabc')).toBe('0xabc');
  });

  test('respects custom head/tail', () => {
    const hash = '0x' + 'cd'.repeat(32);
    expect(shortHash(hash, 4, 4)).toBe(`${hash.slice(0, 4)}…${hash.slice(-4)}`);
  });
});
