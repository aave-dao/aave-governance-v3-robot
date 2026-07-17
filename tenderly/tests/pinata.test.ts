import {describe, expect, test} from 'bun:test';
import {
  createPinataClient,
  looksLikeJwt,
  normalizeGatewayHost,
  PinataError,
  resolvePinataConfig,
  type PinataConfig,
} from '../src/core/pinata';

// A structurally-valid (but fake) Pinata JWT: header `eyJ…`, three dot-separated segments.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2ln';

type StubResp = {status?: number; body: string};

const makeFetch = (handler: (url: string, init?: RequestInit) => StubResp) => {
  const calls: {url: string; init?: RequestInit}[] = [];
  const fn = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({url, init});
    const r = handler(url, init);
    return new Response(r.body, {status: r.status ?? 200});
  }) as unknown as typeof fetch;
  return {fn, calls};
};

const headersOf = (init?: RequestInit): Record<string, string> =>
  (init?.headers ?? {}) as Record<string, string>;

const cfg = (over: Partial<PinataConfig> = {}): PinataConfig => ({jwt: FAKE_JWT, ...over});

describe('looksLikeJwt', () => {
  test.each([
    [FAKE_JWT, true],
    ['eyJa.eyJb.sig', true],
    ['not-a-jwt', false],
    ['eyJonly', false],
    ['a.b.c', false], // header must start with eyJ
  ])('%s → %s', (input, expected) => {
    expect(looksLikeJwt(input)).toBe(expected);
  });
});

describe('resolvePinataConfig', () => {
  test('accepts a valid JWT', () => {
    const c = resolvePinataConfig({PINATA_JWT: FAKE_JWT} as never);
    expect(c.jwt).toBe(FAKE_JWT);
  });

  test('captures gateway + token', () => {
    const c = resolvePinataConfig({
      PINATA_JWT: FAKE_JWT,
      PINATA_GATEWAY: 'my.mypinata.cloud',
      PINATA_GATEWAY_KEY: 'tok',
    } as never);
    expect(c.gateway).toBe('my.mypinata.cloud');
    expect(c.gatewayToken).toBe('tok');
  });

  test('malformed JWT → throws (guards api-key-pasted-into-JWT footgun)', () => {
    expect(() => resolvePinataConfig({PINATA_JWT: 'not-a-jwt'} as never)).toThrow(
      /does not look like a JWT/,
    );
  });

  test('key + secret but no JWT → throws with a V3-specific hint', () => {
    expect(() =>
      resolvePinataConfig({PINATA_API_KEY: 'k', PINATA_API_SECRET: 's'} as never),
    ).toThrow(/V3 Pinata API needs a JWT/);
  });

  test('nothing set → throws', () => {
    expect(() => resolvePinataConfig({} as never)).toThrow(PinataError);
  });
});

describe('normalizeGatewayHost', () => {
  test.each([
    ['https://x.mypinata.cloud', 'x.mypinata.cloud'],
    ['http://x.mypinata.cloud/', 'x.mypinata.cloud'],
    ['x.mypinata.cloud/', 'x.mypinata.cloud'],
    ['x.mypinata.cloud', 'x.mypinata.cloud'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeGatewayHost(input)).toBe(expected);
  });
});

describe('auth header', () => {
  test('every request carries Authorization: Bearer <jwt>', async () => {
    const {fn, calls} = makeFetch(() => ({body: '{"data":{"files":[]}}'}));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    await c.listFilesByCid('QmX');
    expect(headersOf(calls[0]!.init).Authorization).toBe(`Bearer ${FAKE_JWT}`);
  });
});

describe('pinByCid', () => {
  test('POSTs to the V3 pin_by_cid endpoint and unwraps data', async () => {
    const {fn, calls} = makeFetch(() => ({
      body: JSON.stringify({data: {id: 'job-1', cid: 'QmX', status: 'prechecking'}}),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    const res = await c.pinByCid('QmX', {metadata: {name: 'p-1', keyvalues: {a: 'b'}}});
    expect(res).toEqual({id: 'job-1', cid: 'QmX', status: 'prechecking'});

    const call = calls[0]!;
    expect(call.url).toBe('https://api.pinata.cloud/v3/files/public/pin_by_cid');
    expect(call.init!.method).toBe('POST');
    const body = JSON.parse(String(call.init!.body));
    expect(body.cid).toBe('QmX');
    expect(body.name).toBe('p-1');
    expect(body.keyvalues).toEqual({a: 'b'});
  });

  test('passes host_nodes when given', async () => {
    const {fn, calls} = makeFetch(() => ({
      body: '{"data":{"id":"1","cid":"QmX","status":"searching"}}',
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    await c.pinByCid('QmX', {hostNodes: ['/dns4/host/tcp/4001/p2p/Qm']});
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.host_nodes).toEqual(['/dns4/host/tcp/4001/p2p/Qm']);
  });

  test('non-2xx → PinataError carrying status', async () => {
    const {fn} = makeFetch(() => ({status: 401, body: '{"error":"unauthorized"}'}));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    await expect(c.pinByCid('QmX')).rejects.toMatchObject({status: 401});
  });
});

describe('uploadFileBytes', () => {
  test('POSTs multipart to the uploads host with network=public and returns cid', async () => {
    const {fn, calls} = makeFetch(() => ({
      body: JSON.stringify({data: {id: 'f1', cid: 'QmY', size: 5}}),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    const res = await c.uploadFileBytes(new TextEncoder().encode('hello'), {fileName: 'f.md'});
    expect(res.cid).toBe('QmY');
    expect(calls[0]!.url).toBe('https://uploads.pinata.cloud/v3/files');
    const form = calls[0]!.init!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('network')).toBe('public');
  });
});

describe('listFilesByCid / isPinned', () => {
  test('filters data.files to exact cid match', async () => {
    const {fn, calls} = makeFetch(() => ({
      body: JSON.stringify({
        data: {
          files: [
            {id: '1', cid: 'QmMatch'},
            {id: '2', cid: 'QmOther'},
          ],
        },
      }),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    const files = await c.listFilesByCid('QmMatch');
    expect(files).toHaveLength(1);
    expect(files[0]!.cid).toBe('QmMatch');
    expect(calls[0]!.url).toBe('https://api.pinata.cloud/v3/files/public?cid=QmMatch');
  });

  test('isPinned true when a matching file exists', async () => {
    const {fn} = makeFetch(() => ({
      body: JSON.stringify({data: {files: [{id: '1', cid: 'QmZ'}]}}),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    expect(await c.isPinned('QmZ')).toBe(true);
  });

  test('isPinned false when no matching file', async () => {
    const {fn} = makeFetch(() => ({
      body: JSON.stringify({data: {files: [{id: '1', cid: 'QmOther'}]}}),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    expect(await c.isPinned('QmZ')).toBe(false);
  });
});

describe('listPinJobsByCid', () => {
  test('returns matching jobs from data.jobs', async () => {
    const {fn} = makeFetch(() => ({
      body: JSON.stringify({
        data: {
          jobs: [
            {id: 'j1', cid: 'QmZ', status: 'retrieving'},
            {id: 'j2', cid: 'QmNope', status: 'expired'},
          ],
        },
      }),
    }));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    const jobs = await c.listPinJobsByCid('QmZ');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('retrieving');
  });

  test('is best-effort: a non-2xx (e.g. endpoint unavailable) resolves to []', async () => {
    const {fn} = makeFetch(() => ({status: 404, body: 'nope'}));
    const c = createPinataClient(cfg({fetchImpl: fn}));
    expect(await c.listPinJobsByCid('QmZ')).toEqual([]);
  });
});

describe('gateway', () => {
  test('gatewayUrl builds https URL and appends token', () => {
    const c = createPinataClient(cfg({gateway: 'https://gw.mypinata.cloud/', gatewayToken: 'tok'}));
    expect(c.gatewayUrl('QmA')).toBe('https://gw.mypinata.cloud/ipfs/QmA?pinataGatewayToken=tok');
  });

  test('gatewayUrl throws without a configured gateway', () => {
    const c = createPinataClient(cfg());
    expect(() => c.gatewayUrl('QmA')).toThrow(/no PINATA_GATEWAY/);
  });

  test('fetchFromGateway returns text on 200', async () => {
    const {fn} = makeFetch(() => ({body: 'doc-body'}));
    const c = createPinataClient(cfg({gateway: 'gw.mypinata.cloud', fetchImpl: fn}));
    expect(await c.fetchFromGateway('QmA')).toBe('doc-body');
  });

  test('fetchFromGateway throws on non-2xx', async () => {
    const {fn} = makeFetch(() => ({status: 404, body: ''}));
    const c = createPinataClient(cfg({gateway: 'gw.mypinata.cloud', fetchImpl: fn}));
    await expect(c.fetchFromGateway('QmA')).rejects.toThrow(PinataError);
  });
});
