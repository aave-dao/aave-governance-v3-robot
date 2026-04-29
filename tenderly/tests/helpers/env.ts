/**
 * Snapshot/restore process.env around a function. Pass `{KEY: undefined}` to delete a key
 * that was previously present. Restores the snapshot whether the function throws or not,
 * so tests don't leak env state across cases.
 */
export const withEnv = async <T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> => {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    snapshot[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  }
};
