import {describe, expect, test} from 'bun:test';
import {computeCidV0FromBytes, computeCidV0FromText} from '../src/core/ipfs';
import {PinataError, type PinataClient} from '../src/core/pinata';
import {FilebaseError, type FilebaseClient} from '../src/core/filebase';
import {makeFilebaseProvider, makePinataProvider, type BackupMeta} from '../src/core/providers';
import {silentLogger} from './helpers/mockClient';

const CONTENT_A = '---\ntitle: Proposal A\n---\n\nBody of proposal A.\n';
const META: BackupMeta = {proposalIds: [1n, 2n], ipfsHash: '0xabc'};

// ---------------- mock low-level Pinata client ----------------

type MockPinataOpts = {
  gateway?: string;
  initiallyPinned?: string[];
  pinByCidPins?: boolean;
  pinByCidThrows?: boolean;
  reuploadPins?: boolean;
  jobs?: Record<string, {status: string}[]>;
  gatewayContent?: Record<string, string>;
};

const makeMockPinata = (o: MockPinataOpts & {deleteThrows?: boolean} = {}) => {
  const pinned = new Set<string>(o.initiallyPinned ?? []);
  const calls = {
    pinByCid: [] as string[],
    upload: [] as {cid: string; size: number}[],
    deleted: [] as string[],
  };
  const client = {
    config: {jwt: 'x', gateway: o.gateway},
    isPinned: async (cid: string) => pinned.has(cid),
    // Mock uses id === cid so deleteFile(id) can map back to the pinned entry.
    listFilesByCid: async (cid: string) => (pinned.has(cid) ? [{id: cid, cid}] : []),
    listPinJobsByCid: async (cid: string) =>
      (o.jobs?.[cid] ?? []).map((j) => ({id: 'j', cid, status: j.status})),
    pinByCid: async (cid: string) => {
      calls.pinByCid.push(cid);
      if (o.pinByCidThrows) throw new PinataError('pinByCid boom');
      if (o.pinByCidPins) pinned.add(cid);
      return {id: 'job', cid, status: 'prechecking'};
    },
    uploadFileBytes: async (bytes: Uint8Array) => {
      const cid = await computeCidV0FromBytes(bytes);
      calls.upload.push({cid, size: bytes.length});
      if (o.reuploadPins !== false) pinned.add(cid);
      return {id: 'up', cid};
    },
    deleteFile: async (id: string) => {
      if (o.deleteThrows) throw new PinataError('delete boom', 500);
      calls.deleted.push(id);
      pinned.delete(id);
    },
    fetchFromGateway: async (cid: string) => {
      if (o.gatewayContent && cid in o.gatewayContent) return o.gatewayContent[cid]!;
      if (!pinned.has(cid)) throw new PinataError('gateway 404', 404);
      return '';
    },
    gatewayUrl: (cid: string) => `https://gw/ipfs/${cid}`,
  };
  return {client: client as unknown as PinataClient, pinned, calls};
};

const pinataOpts = (over: Partial<Parameters<typeof makePinataProvider>[1]> = {}) => ({
  verifyViaGateway: true,
  allowReupload: false,
  pinTimeoutMs: 50,
  pollIntervalMs: 1,
  logger: silentLogger,
  ...over,
});

describe('PinataProvider', () => {
  const cid = () => computeCidV0FromText(CONTENT_A);

  test('isBacked delegates to the account file list', async () => {
    const c = await cid();
    const {client} = makeMockPinata({initiallyPinned: [c]});
    const p = makePinataProvider(client, pinataOpts());
    expect(await p.isBacked(c)).toBe(true);
    expect(await p.isBacked('QmOther')).toBe(false);
  });

  test('backup: pin-by-cid completes → backed', async () => {
    const c = await cid();
    const {client, calls} = makeMockPinata({gateway: 'gw', pinByCidPins: true});
    const p = makePinataProvider(client, pinataOpts());
    const out = await p.backup(c, {meta: META});
    expect(out).toEqual({status: 'backed', method: 'pin-by-cid'});
    expect(calls.pinByCid).toEqual([c]);
  });

  test('backup: in-flight job → pending, not re-queued', async () => {
    const c = await cid();
    const {client, calls} = makeMockPinata({jobs: {[c]: [{status: 'prechecking'}]}});
    const p = makePinataProvider(client, pinataOpts());
    const out = await p.backup(c, {meta: META});
    expect(out.status).toBe('pending');
    expect(calls.pinByCid).toHaveLength(0);
  });

  test('backup: queued but unconfirmed within timeout → pending', async () => {
    const c = await cid();
    const {client} = makeMockPinata({pinByCidPins: false});
    const p = makePinataProvider(client, pinataOpts());
    const out = await p.backup(c, {meta: META});
    expect(out.status).toBe('pending');
    expect(out.method).toBe('pin-by-cid');
  });

  test('backup: terminal failure + allowReupload + matching bytes → re-upload backed', async () => {
    const c = await cid();
    const {client, calls} = makeMockPinata({jobs: {[c]: [{status: 'bad_host_node'}]}});
    const p = makePinataProvider(client, pinataOpts({allowReupload: true}));
    const out = await p.backup(c, {
      content: new TextEncoder().encode(CONTENT_A),
      contentMatchesCid: true,
      meta: META,
    });
    expect(out).toEqual({status: 'backed', method: 're-upload'});
    expect(calls.upload).toHaveLength(1);
  });

  test('backup: terminal failure without allowReupload → failed (no upload)', async () => {
    const c = await cid();
    const {client, calls} = makeMockPinata({jobs: {[c]: [{status: 'expired'}]}});
    const p = makePinataProvider(client, pinataOpts());
    const out = await p.backup(c, {meta: META});
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('expired');
    expect(calls.upload).toHaveLength(0);
  });

  test('verify: account-based when gateway verification disabled', async () => {
    const c = await cid();
    const {client} = makeMockPinata({initiallyPinned: [c]});
    const p = makePinataProvider(client, pinataOpts({verifyViaGateway: false}));
    expect(await p.verify(c)).toBe(true);
  });

  test('verify: gateway-based re-checks the served CID', async () => {
    const c = await cid();
    const {client} = makeMockPinata({gateway: 'gw', gatewayContent: {[c]: CONTENT_A}});
    const p = makePinataProvider(client, pinataOpts({verifyViaGateway: true}));
    expect(await p.verify(c)).toBe(true);
  });

  test('verify: gateway serving mismatched content → false', async () => {
    const c = await cid();
    const {client} = makeMockPinata({gateway: 'gw', gatewayContent: {[c]: 'wrong'}});
    const p = makePinataProvider(client, pinataOpts({verifyViaGateway: true}));
    expect(await p.verify(c)).toBe(false);
  });

  test('unpin: present → deletes each file record and reports count', async () => {
    const c = await cid();
    const {client, calls, pinned} = makeMockPinata({initiallyPinned: [c]});
    const p = makePinataProvider(client, pinataOpts());
    const out = await p.unpin(c);
    expect(out).toEqual({status: 'unpinned', count: 1});
    expect(calls.deleted).toEqual([c]);
    expect(pinned.has(c)).toBe(false);
  });

  test('unpin: not on the account → not-present, no delete', async () => {
    const c = await cid();
    const {client, calls} = makeMockPinata();
    const p = makePinataProvider(client, pinataOpts());
    expect(await p.unpin(c)).toEqual({status: 'not-present'});
    expect(calls.deleted).toHaveLength(0);
  });

  test('unpin: delete error → failed (never throws)', async () => {
    const c = await cid();
    const {client} = makeMockPinata({initiallyPinned: [c], deleteThrows: true});
    const p = makePinataProvider(client, pinataOpts());
    expect((await p.unpin(c)).status).toBe('failed');
  });
});

// ---------------- mock low-level Filebase client ----------------

type MockFilebaseOpts = {
  stored?: Record<string, string>; // cid -> assigned cid (usually same)
  putReturns?: (cid: string, bytes: Uint8Array) => string | null; // override assigned cid
  putThrows?: boolean;
};

const makeMockFilebase = (o: MockFilebaseOpts = {}) => {
  const stored = new Map<string, string>(Object.entries(o.stored ?? {}));
  const calls = {prepared: 0, put: [] as {cid: string; size: number}[], deleted: [] as string[]};
  const client = {
    config: {
      endpoint: 'https://s3.filebase.io',
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
    objectKey: (cid: string) => `proposals/${cid}`,
    objectUrl: (cid: string) => `https://s3.filebase.io/b/proposals/${cid}`,
    ensureBucket: async () => {
      calls.prepared++;
    },
    headCid: async (cid: string) => stored.get(cid) ?? null,
    putContent: async (cid: string, bytes: Uint8Array) => {
      if (o.putThrows) throw new FilebaseError('put boom', 500);
      const assigned = o.putReturns ? o.putReturns(cid, bytes) : await computeCidV0FromBytes(bytes);
      calls.put.push({cid, size: bytes.length});
      if (assigned) stored.set(cid, assigned);
      return assigned;
    },
    deleteObject: async (cid: string) => {
      calls.deleted.push(cid);
      stored.delete(cid);
    },
  };
  return {client: client as unknown as FilebaseClient, stored, calls};
};

describe('FilebaseProvider', () => {
  const cid = () => computeCidV0FromText(CONTENT_A);

  test('needsContent is true (upload-based)', () => {
    const {client} = makeMockFilebase();
    expect(makeFilebaseProvider(client, {logger: silentLogger}).needsContent).toBe(true);
  });

  test('prepare creates the bucket', async () => {
    const {client, calls} = makeMockFilebase();
    await makeFilebaseProvider(client, {logger: silentLogger}).prepare!();
    expect(calls.prepared).toBe(1);
  });

  test('isBacked true only when stored CID matches exactly', async () => {
    const c = await cid();
    const {client} = makeMockFilebase({stored: {[c]: c}});
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    expect(await p.isBacked(c)).toBe(true);
    expect(await p.isBacked('QmOther')).toBe(false);
  });

  test('backup: upload reproduces the exact CID → backed', async () => {
    const c = await cid();
    const {client, calls} = makeMockFilebase();
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.backup(c, {
      content: new TextEncoder().encode(CONTENT_A),
      contentMatchesCid: true,
      meta: META,
    });
    expect(out).toEqual({status: 'backed', method: 's3-upload'});
    expect(calls.put).toHaveLength(1);
    expect(await p.verify(c)).toBe(true);
  });

  test('backup: Filebase returns a different CID → failed, refused', async () => {
    const c = await cid();
    const {client} = makeMockFilebase({putReturns: () => 'bafkreidifferent'});
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.backup(c, {
      content: new TextEncoder().encode(CONTENT_A),
      contentMatchesCid: true,
      meta: META,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('expected');
  });

  test('backup: no content → failed', async () => {
    const c = await cid();
    const {client} = makeMockFilebase();
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.backup(c, {meta: META});
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('content');
  });

  test('backup: fetched bytes flagged not matching CID → failed, no upload', async () => {
    const c = await cid();
    const {client, calls} = makeMockFilebase();
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.backup(c, {
      content: new TextEncoder().encode('x'),
      contentMatchesCid: false,
      meta: META,
    });
    expect(out.status).toBe('failed');
    expect(calls.put).toHaveLength(0);
  });

  test('backup: upload throws → failed (never throws out)', async () => {
    const c = await cid();
    const {client} = makeMockFilebase({putThrows: true});
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.backup(c, {
      content: new TextEncoder().encode(CONTENT_A),
      contentMatchesCid: true,
      meta: META,
    });
    expect(out.status).toBe('failed');
  });

  test('unpin: stored → deletes the object', async () => {
    const c = await cid();
    const {client, calls, stored} = makeMockFilebase({stored: {[c]: c}});
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    const out = await p.unpin(c);
    expect(out).toEqual({status: 'unpinned', count: 1});
    expect(calls.deleted).toEqual([c]);
    expect(stored.has(c)).toBe(false);
  });

  test('unpin: not stored → not-present, no delete', async () => {
    const c = await cid();
    const {client, calls} = makeMockFilebase();
    const p = makeFilebaseProvider(client, {logger: silentLogger});
    expect(await p.unpin(c)).toEqual({status: 'not-present'});
    expect(calls.deleted).toHaveLength(0);
  });
});
