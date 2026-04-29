/**
 * Lightweight `globalThis.fetch` swap used by tests that exercise notify/ipfs/rpc paths.
 * The responder is a function: tests inspect (url, init) and decide what to return per call.
 * `calls` records each invocation (url + parsed body when JSON) so assertions stay simple.
 */
export type FetchCall = {url: string; init?: RequestInit; bodyText?: string};

export type FetchResponseSpec = {status?: number; body: string; throwError?: Error};

export const installFetchMock = (
  responder: (url: string, init?: RequestInit) => FetchResponseSpec,
): {restore: () => void; calls: FetchCall[]} => {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url =
      typeof input === 'string' || input instanceof URL ? String(input) : (input as Request).url;
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({url, init, bodyText});
    const spec = responder(url, init);
    if (spec.throwError) throw spec.throwError;
    return new Response(spec.body, {status: spec.status ?? 200});
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calls,
  };
};
