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
  let remainder = abs;
  const parts: string[] = [];
  for (const [u, label] of units) {
    if (remainder >= u) {
      const n = Math.floor(remainder / u);
      remainder -= n * u;
      parts.push(`${n}${label}`);
      if (parts.length === 2) break;
    }
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
