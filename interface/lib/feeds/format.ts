// Display formatters + the node-type color palette. Ported from tmp-ref/feed-graph.ts so
// the engine has no dependency on the (to-be-deleted) reference script. All functions take
// bigints/numbers and return display strings — values are stringified at classify time so
// nothing downstream has to deal with bigint serialization.

export const ZERO = '0x0000000000000000000000000000000000000000';

export const short = (a: string): string =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

export function fmtUsd(ans: bigint, dec: number): string {
  const v = Number(ans) / 10 ** dec;
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return (
    '$' +
    v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 2 })
  );
}

export const fmtRatio = (r: bigint, dec: number): string => (Number(r) / 10 ** dec).toFixed(8);

export const fmtTs = (t: bigint): string =>
  `${t} (${new Date(Number(t) * 1000).toISOString().replace('.000Z', 'Z')})`;

export const fmtPct = (bps: bigint): string => `${(Number(bps) / 100).toFixed(2)}% (${bps} bps)`;

export const fmtDays = (s: bigint): string => `${Number(s) / 86400}d (${s}s)`;

/** Compact human duration from seconds: 45 → "45s", 3600 → "1h", 4500 → "1h 15m". */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Node-type → accent color. Drives the left border on cards and the graph legend. */
export const COLORS: Record<string, string> = {
  ChainlinkFeed: '#1f6feb',
  ScaledPriceAdapter: '#1f9e8c',
  PriceCapAdapterStable: '#d29922',
  CLRatePriceCapAdapter: '#8957e5',
  CLSynchronicityPegToBase: '#db61a2',
  OneUSDFixedAdapter: '#6e7681',
  FixedPriceAdapter: '#6e7681',
};

export const colorFor = (type: string): string => COLORS[type] ?? '#6e7681';
