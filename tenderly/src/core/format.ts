/**
 * Shared formatters for human-readable display in CLI / inspect output.
 * Lives in core/ (not cli/) because the action `check()` predicates use them too — the
 * cancelProposal predicate, for example, formats power values as part of its reason string.
 */

/**
 * AAVE / aAAVE / stkAAVE all use 18 decimals (verified on-chain) and the on-chain
 * `Governance.PRECISION_DIVIDER()` is also 10^18. Hardcoded here as a constant — the cache
 * is the constant itself; we don't need to hit RPC for it.
 */
export const AAVE_DECIMALS = 18;

/**
 * Format a wei amount (10^18 base units) as a human-readable token quantity with thousands
 * separators and 2 decimal places: `81479179692280000000000` → `81,479.18`.
 *
 * Uses BigInt math throughout to avoid Number precision loss on large balances.
 */
export const formatTokenAmount = (
  wei: bigint,
  opts: { decimals?: number; fractionDigits?: number } = {},
): string => {
  const decimals = opts.decimals ?? AAVE_DECIMALS;
  const fractionDigits = opts.fractionDigits ?? 2;
  const scale = 10n ** BigInt(decimals);
  const fracScale = 10n ** BigInt(decimals - fractionDigits);

  const whole = wei / scale;
  const frac = (wei % scale) / fracScale;

  const wholeStr = whole.toLocaleString('en-US');
  if (fractionDigits === 0) return wholeStr;
  const fracStr = frac.toString().padStart(fractionDigits, '0');
  return `${wholeStr}.${fracStr}`;
};

/** Convenience: format with the AAVE token symbol appended. */
export const formatAave = (wei: bigint, fractionDigits = 2): string =>
  `${formatTokenAmount(wei, { fractionDigits })} AAVE`;
