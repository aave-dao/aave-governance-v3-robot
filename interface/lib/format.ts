// Server + client safe formatters.

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

export const fmtAbsolute = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
