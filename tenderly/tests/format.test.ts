import {describe, expect, test} from 'bun:test';
import {AAVE_DECIMALS, formatAave, formatTokenAmount} from '../src/core/format';

describe('formatTokenAmount', () => {
  test('zero', () => {
    expect(formatTokenAmount(0n)).toBe('0.00');
  });

  test('formats wei with default 2 fraction digits (truncated, not rounded)', () => {
    // 81479.179692… truncates to 81479.17 because BigInt division floors the fractional part.
    expect(formatTokenAmount(81_479_179_692_280_000_000_000n)).toBe('81,479.17');
  });

  test('zero fraction digits drops the decimal point', () => {
    expect(formatTokenAmount(81_479_179_692_280_000_000_000n, {fractionDigits: 0})).toBe('81,479');
  });

  test('four fraction digits', () => {
    expect(formatTokenAmount(81_479_179_692_280_000_000_000n, {fractionDigits: 4})).toBe(
      '81,479.1796',
    );
  });

  test('custom decimals (USDC-like 6 decimals)', () => {
    expect(formatTokenAmount(1_000_000n, {decimals: 6})).toBe('1.00');
    expect(formatTokenAmount(1_234_567n, {decimals: 6, fractionDigits: 4})).toBe('1.2345');
  });

  test('thousands separators beyond 1e6', () => {
    expect(formatTokenAmount(1_000_000n * 10n ** 18n)).toBe('1,000,000.00');
  });

  test('handles values larger than uint128 without precision loss', () => {
    const huge = 2n ** 256n - 1n;
    const out = formatTokenAmount(huge);
    expect(out).toMatch(/^\d{1,3}(,\d{3})+\.\d{2}$/);
    expect(out).toContain(',');
  });

  test('AAVE_DECIMALS is 18', () => {
    expect(AAVE_DECIMALS).toBe(18);
  });
});

describe('formatAave', () => {
  test('appends AAVE symbol', () => {
    expect(formatAave(10n ** 18n)).toBe('1.00 AAVE');
  });

  test('respects fractionDigits override', () => {
    expect(formatAave(10n ** 18n, 4)).toBe('1.0000 AAVE');
  });
});
