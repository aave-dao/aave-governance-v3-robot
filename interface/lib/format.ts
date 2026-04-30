// Server + client safe formatters. All absolute timestamps render in the *runtime's* local
// timezone, so the browser shows the user's TZ. The server (SSR) and client may compute
// different strings; consumers wrap the rendered text in a node with `suppressHydrationWarning`.

export const fmtRelative = (etaAt: number, now = Math.floor(Date.now() / 1000)): string => {
  const seconds = etaAt - now;
  const ago = seconds < 0;
  const abs = Math.abs(seconds);
  const units: Array<[number, string]> = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ];
  // Under 1 day → show 3 parts (h m s, or 0h 0m 0s) so the seconds tick visibly. Beyond a
  // day → 2 parts (Xd Yh) is clean enough; the user only needs minute precision at that scale.
  const maxParts = abs < 86400 ? 3 : 2;
  let remainder = abs;
  const parts: string[] = [];
  let started = false;
  for (const [u, label] of units) {
    if (!started) {
      // Find the first unit that's actually present, OR fall through to seconds if everything
      // is zero (so we render "0s" instead of nothing).
      if (remainder >= u || u === 1) started = true;
      else continue;
    }
    if (parts.length >= maxParts) break;
    const n = Math.floor(remainder / u);
    remainder -= n * u;
    parts.push(`${n}${label}`);
  }
  if (parts.length === 0) parts.push('0s');
  const text = parts.join(' ');
  return ago ? `${text} ago` : `in ${text}`;
};

const tzAbbr = (d: Date): string => {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
};

const localIso = (d: Date): string => {
  // 'sv-SE' gives ISO-like "YYYY-MM-DD HH:MM:SS" in the runtime's TZ.
  // Fallback (older runtimes or polyfills): build manually.
  try {
    return d
      .toLocaleString('sv-SE', { hour12: false })
      .replace('T', ' ')
      .slice(0, 19);
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
};

export const fmtAbsolute = (unixSeconds: number): string => {
  const d = new Date(unixSeconds * 1000);
  const tz = tzAbbr(d);
  return tz ? `${localIso(d)} ${tz}` : localIso(d);
};

/** Date-only (YYYY-MM-DD) in the runtime's TZ. */
export const fmtDate = (unixSeconds: number): string => {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Format a uint128-wei AAVE amount in compact form: 383.73K, 1.04M, 12.4. Mirrors the way the
 * official Aave UI renders vote tallies. Drops decimals once we cross 1k.
 */
export const fmtCompactAave = (wei: bigint, decimals = 18): string => {
  if (wei === 0n) return '0';
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const fractionalWei = wei - whole * divisor;
  // Convert to a plain number for display only (loses precision past ~1e15 but we only render
  // 2-3 sig figs).
  const wholeNum = Number(whole);
  const fracNum = Number(fractionalWei) / Number(divisor);
  const total = wholeNum + fracNum;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(2)}K`;
  if (total >= 1) return total.toFixed(2);
  return total.toFixed(4);
};
