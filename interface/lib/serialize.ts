// Deep-walk a value and convert any bigints to decimal strings, so it can be passed to
// JSON.stringify or stored in jsonb columns. Returns a new object — does not mutate input.
export const jsonSafe = <T>(value: T): unknown => {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'bigint') return (value as unknown as bigint).toString();
  if (t !== 'object') return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = jsonSafe(v);
  }
  return out;
};
