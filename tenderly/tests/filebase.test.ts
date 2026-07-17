import {describe, expect, test} from 'bun:test';
import {
  createFilebaseClient,
  FilebaseError,
  resolveFilebaseConfig,
  type SignedFetch,
} from '../src/core/filebase';

type StubResp = {status?: number; body?: string; headers?: Record<string, string>};

const makeSigned = (handler: (method: string, url: string, init?: RequestInit) => StubResp) => {
  const calls: {method: string; url: string; init?: RequestInit}[] = [];
  const fn: SignedFetch = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({method, url: String(url), init});
    const r = handler(method, String(url), init);
    return new Response(r.body ?? '', {status: r.status ?? 200, headers: r.headers});
  };
  return {fn, calls};
};

const CID = 'Qmf7DQqMY1L5wpW3KymVxBJQcB7AensPWqeYQUmfZPt5F1';

describe('resolveFilebaseConfig', () => {
  test('reads keys + applies endpoint/bucket defaults', () => {
    const c = resolveFilebaseConfig({
      FILEBASE_ACCESS_TOKEN: 'k',
      FILEBASE_SECRET_KEY: 's',
    } as never);
    expect(c.accessKeyId).toBe('k');
    expect(c.secretAccessKey).toBe('s');
    expect(c.endpoint).toBe('https://s3.filebase.io');
    expect(c.bucket).toBe('aave-gov-v3-proposals');
  });

  test('honors custom endpoint (trailing slash trimmed) + bucket', () => {
    const c = resolveFilebaseConfig({
      FILEBASE_ACCESS_TOKEN: 'k',
      FILEBASE_SECRET_KEY: 's',
      FILEBASE_API_ENDPOINT: 'https://s3.filebase.io/',
      FILEBASE_BUCKET: 'my-bucket',
    } as never);
    expect(c.endpoint).toBe('https://s3.filebase.io');
    expect(c.bucket).toBe('my-bucket');
  });

  test('throws when credentials are missing', () => {
    expect(() => resolveFilebaseConfig({} as never)).toThrow(/credentials missing/);
    expect(() => resolveFilebaseConfig({FILEBASE_ACCESS_TOKEN: 'k'} as never)).toThrow(
      FilebaseError,
    );
  });
});

const config = (signedFetch: SignedFetch) => ({
  accessKeyId: 'k',
  secretAccessKey: 's',
  endpoint: 'https://s3.filebase.io',
  bucket: 'b',
  signedFetch,
});

describe('createFilebaseClient', () => {
  test('objectUrl targets the bucket + prefixed key', () => {
    const {fn} = makeSigned(() => ({}));
    const c = createFilebaseClient(config(fn));
    expect(c.objectUrl(CID)).toBe(`https://s3.filebase.io/b/proposals/${CID}`);
  });

  test('ensureBucket: existing bucket (HEAD 200) → no create', async () => {
    const {fn, calls} = makeSigned(() => ({status: 200}));
    await createFilebaseClient(config(fn)).ensureBucket();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('HEAD');
  });

  test('ensureBucket: missing bucket (HEAD 404) → PUT create on the ipfs network', async () => {
    const {fn, calls} = makeSigned((method) => (method === 'HEAD' ? {status: 404} : {status: 200}));
    await createFilebaseClient(config(fn)).ensureBucket();
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'PUT']);
    expect((calls[1]!.init!.headers as Record<string, string>)['x-amz-meta-network']).toBe('ipfs');
  });

  test('ensureBucket: unexpected status → throws', async () => {
    const {fn} = makeSigned(() => ({status: 500}));
    await expect(createFilebaseClient(config(fn)).ensureBucket()).rejects.toThrow(FilebaseError);
  });

  test('headCid: returns the stored CID header', async () => {
    const {fn} = makeSigned(() => ({status: 200, headers: {'x-amz-meta-cid': CID}}));
    expect(await createFilebaseClient(config(fn)).headCid(CID)).toBe(CID);
  });

  test('headCid: 404 → null', async () => {
    const {fn} = makeSigned(() => ({status: 404}));
    expect(await createFilebaseClient(config(fn)).headCid(CID)).toBeNull();
  });

  test('putContent: PUTs bytes + returns the assigned CID, with metadata headers', async () => {
    const {fn, calls} = makeSigned(() => ({status: 200, headers: {'x-amz-meta-cid': CID}}));
    const got = await createFilebaseClient(config(fn)).putContent(
      CID,
      new TextEncoder().encode('hello'),
      {proposalIds: '1,2', ipfsHash: '0xabc'},
    );
    expect(got).toBe(CID);
    const put = calls[0]!;
    expect(put.method).toBe('PUT');
    expect(put.url).toBe(`https://s3.filebase.io/b/proposals/${CID}`);
    const headers = put.init!.headers as Record<string, string>;
    expect(headers['x-amz-meta-proposalids']).toBe('1,2');
    expect(headers['x-amz-meta-ipfshash']).toBe('0xabc');
  });

  test('putContent: non-2xx → throws', async () => {
    const {fn} = makeSigned(() => ({status: 403, body: 'denied'}));
    await expect(
      createFilebaseClient(config(fn)).putContent(CID, new Uint8Array([1])),
    ).rejects.toThrow(FilebaseError);
  });
});
