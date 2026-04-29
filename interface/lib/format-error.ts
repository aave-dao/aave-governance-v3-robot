// Pull as much debug context as possible out of an error before persisting it.
// Viem's contract errors attach `shortMessage`, `metaMessages` (call inputs / contract / fn /
// args) and a `cause` chain that often surfaces the decoded revert reason or RPC error body.
// We flatten all of that into one multi-line string so a developer reading the executions row
// can see exactly what reverted.

const MAX = 4_000;

const pickProp = (obj: unknown, key: string): string | undefined => {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (Array.isArray(v)) {
    const joined = v.filter((x) => typeof x === 'string' && x.length > 0).join('\n');
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
};

const visitedCauses = (root: unknown): unknown[] => {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let cur = root;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
};

export const formatError = (err: unknown): string => {
  if (typeof err === 'string') return err.slice(0, MAX);
  if (err === null || err === undefined) return 'unknown error';

  const lines: string[] = [];

  // shortMessage is viem's one-liner; if absent we fall back to .message.
  const top = err as { name?: string; message?: string };
  const short = pickProp(err, 'shortMessage') ?? top.message ?? String(err);
  if (top.name && top.name !== 'Error') {
    lines.push(`[${top.name}] ${short}`);
  } else {
    lines.push(short);
  }

  for (const node of visitedCauses(err)) {
    const meta = pickProp(node, 'metaMessages');
    if (meta) lines.push(meta);
    // Viem's ContractFunctionRevertedError surfaces decoded revert as `reason` or `data`.
    const reason = pickProp(node, 'reason');
    if (reason && !lines.some((l) => l.includes(reason))) {
      lines.push(`reason: ${reason}`);
    }
    const data = pickProp(node, 'data');
    if (data && !lines.some((l) => l.includes(data))) {
      lines.push(`data: ${data}`);
    }
    // Some node-fetch / undici errors surface the body here.
    const details = pickProp(node, 'details');
    if (details && !lines.some((l) => l.includes(details))) {
      lines.push(`details: ${details}`);
    }
  }

  let combined = lines.join('\n');
  if (combined.length > MAX) combined = combined.slice(0, MAX - 3) + '...';
  return combined;
};
