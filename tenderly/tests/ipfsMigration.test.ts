import {describe, expect, test} from 'bun:test';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Hex} from 'viem';
import {
  collectProposalCids,
  mapWithConcurrency,
  migrateGroup,
  migrateToProvider,
  type ProposalCidGroup,
} from '../src/core/ipfsMigration';
import {computeCidV0FromText} from '../src/core/ipfs';
import type {BackupOutcome, BackupProvider} from '../src/core/providers';
import {makeMockClient, silentLogger} from './helpers/mockClient';
import {installFetchMock} from './helpers/mockFetch';

const GOV = (GovernanceV3Ethereum.GOVERNANCE as string).toLowerCase();
const ZERO = ('0x' + '00'.repeat(32)) as Hex;
const hash = (n: number): Hex => ('0x' + n.toString(16).padStart(64, '0')) as Hex;

const CONTENT_A = '---\ntitle: Proposal A\n---\n\nBody of proposal A.\n';

// ---------------- generic mock BackupProvider ----------------

type MockProviderOpts = {
  name?: string;
  needsContent?: boolean;
  backed?: string[];
  backup?: (cid: string, ctx: Parameters<BackupProvider['backup']>[1]) => BackupOutcome;
  verify?: (cid: string) => boolean;
};

const makeMockProvider = (o: MockProviderOpts = {}) => {
  const backed = new Set<string>(o.backed ?? []);
  const calls = {
    prepared: 0,
    isBacked: [] as string[],
    backup: [] as {cid: string; ctx: Parameters<BackupProvider['backup']>[1]}[],
    verify: [] as string[],
  };
  const provider: BackupProvider = {
    name: o.name ?? 'mock',
    needsContent: o.needsContent ?? false,
    prepare: async () => {
      calls.prepared++;
    },
    isBacked: async (cid) => {
      calls.isBacked.push(cid);
      return backed.has(cid);
    },
    backup: async (cid, ctx) => {
      calls.backup.push({cid, ctx});
      const out: BackupOutcome = o.backup ? o.backup(cid, ctx) : {status: 'backed', method: 'mock'};
      if (out.status === 'backed') backed.add(cid);
      return out;
    },
    verify: async (cid) => {
      calls.verify.push(cid);
      return o.verify ? o.verify(cid) : backed.has(cid);
    },
    unpin: async (cid) => {
      if (!backed.has(cid)) return {status: 'not-present'};
      backed.delete(cid);
      return {status: 'unpinned', count: 1};
    },
  };
  return {provider, calls, backed};
};

const groupOpts = (over: Partial<Parameters<typeof migrateGroup>[2]> = {}) => ({
  dryRun: false,
  logger: silentLogger,
  ...over,
});

// ---------------- mapWithConcurrency ----------------

describe('mapWithConcurrency', () => {
  test('preserves order and processes every item', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  test('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({length: 12}, (_, i) => i),
      3,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return n;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});

// ---------------- collectProposalCids ----------------

describe('collectProposalCids', () => {
  const buildClient = (count: bigint, byId: Record<number, Hex>) =>
    makeMockClient({
      [`${GOV}.getProposalsCount`]: count,
      [`${GOV}.getProposal`]: (args: readonly unknown[]) => ({
        ipfsHash: byId[Number(args[0])] ?? ZERO,
      }),
    });

  test('groups by CID, dedupes shared hashes, and skips zero hashes', async () => {
    const client = buildClient(5n, {0: hash(11), 1: ZERO, 2: hash(7), 3: hash(7), 4: hash(9)});
    const res = await collectProposalCids(client, {logger: silentLogger});

    expect(res.totalProposals).toBe(5);
    expect(res.scannedFrom).toBe(0);
    expect(res.scannedTo).toBe(4);
    expect(res.noIpfsProposalIds).toEqual([1n]);
    expect(res.groups).toHaveLength(3);

    const shared = res.groups.find((g) => g.proposalIds.length === 2);
    expect(shared?.proposalIds).toEqual([2n, 3n]);
  });

  test('honors from/to and clamps to available range', async () => {
    const client = buildClient(5n, {0: hash(11), 1: hash(1), 2: hash(7), 3: hash(8), 4: hash(9)});
    const res = await collectProposalCids(client, {from: 2, to: 99, logger: silentLogger});
    expect(res.scannedFrom).toBe(2);
    expect(res.scannedTo).toBe(4);
    expect(res.groups.flatMap((g) => g.proposalIds).sort()).toEqual([2n, 3n, 4n]);
  });

  test('empty governance contract → no groups', async () => {
    const client = buildClient(0n, {});
    const res = await collectProposalCids(client, {logger: silentLogger});
    expect(res.totalProposals).toBe(0);
    expect(res.groups).toHaveLength(0);
  });
});

// ---------------- migrateGroup (generic over BackupProvider) ----------------

describe('migrateGroup', () => {
  const group = async (): Promise<ProposalCidGroup> => ({
    cid: await computeCidV0FromText(CONTENT_A),
    ipfsHash: hash(42),
    proposalIds: [1n],
  });

  test('already backed → verify + skip, no backup', async () => {
    const g = await group();
    const {provider, calls} = makeMockProvider({backed: [g.cid]});
    const item = await migrateGroup(provider, g, groupOpts());
    expect(item.status).toBe('already-pinned');
    expect(item.method).toBe('already-backed');
    expect(item.pinned).toBe(true);
    expect(item.verified).toBe(true);
    expect(calls.backup).toHaveLength(0);
  });

  test('content-provider: fetches, verifies hash, backs up (pinned)', async () => {
    const g = await group();
    const {provider, calls} = makeMockProvider({needsContent: true});
    const {restore} = installFetchMock(() => ({status: 200, body: CONTENT_A}));
    try {
      const item = await migrateGroup(provider, g, groupOpts());
      expect(item.status).toBe('pinned');
      expect(item.sourceAvailable).toBe(true);
      expect(item.localCidMatch).toBe(true);
      expect(item.verified).toBe(true);
      // engine passed content + a positive CID match to the provider
      expect(calls.backup[0]!.ctx.content).toBeInstanceOf(Uint8Array);
      expect(calls.backup[0]!.ctx.contentMatchesCid).toBe(true);
    } finally {
      restore();
    }
  });

  test('content-provider: gateway serves wrong content → contentMatchesCid=false passed through', async () => {
    const g = await group();
    const {provider, calls} = makeMockProvider({
      needsContent: true,
      backup: (_cid, ctx) =>
        ctx.contentMatchesCid
          ? {status: 'backed', method: 'mock'}
          : {status: 'failed', method: 'mock', reason: 'mismatch'},
    });
    const {restore} = installFetchMock(() => ({status: 200, body: 'totally different'}));
    try {
      const item = await migrateGroup(provider, g, groupOpts());
      expect(item.localCidMatch).toBe(false);
      expect(calls.backup[0]!.ctx.contentMatchesCid).toBe(false);
      expect(item.status).toBe('failed');
    } finally {
      restore();
    }
  });

  test('pin-by-cid provider (no content needed) does not fetch source', async () => {
    const g = await group();
    const {provider, calls} = makeMockProvider({needsContent: false});
    let fetched = false;
    const {restore} = installFetchMock(() => {
      fetched = true;
      return {status: 200, body: CONTENT_A};
    });
    try {
      const item = await migrateGroup(provider, g, groupOpts());
      expect(item.status).toBe('pinned');
      expect(fetched).toBe(false); // never touched a gateway
      expect(calls.backup[0]!.ctx.content).toBeUndefined();
    } finally {
      restore();
    }
  });

  test('provider returns pending → status pending, not verified', async () => {
    const g = await group();
    const {provider} = makeMockProvider({
      backup: () => ({status: 'pending', method: 'pin-by-cid', reason: 'queued'}),
    });
    const item = await migrateGroup(provider, g, groupOpts());
    expect(item.status).toBe('pending');
    expect(item.verified).toBe(false);
    expect(item.reason).toBe('queued');
  });

  test('provider returns failed → status failed', async () => {
    const g = await group();
    const {provider} = makeMockProvider({
      backup: () => ({status: 'failed', method: 'pin-by-cid', reason: 'nope'}),
    });
    const item = await migrateGroup(provider, g, groupOpts());
    expect(item.status).toBe('failed');
    expect(item.reason).toBe('nope');
  });

  test('dry-run fetches + verifies but does not back up', async () => {
    const g = await group();
    const {provider, calls} = makeMockProvider({needsContent: true});
    const {restore} = installFetchMock(() => ({status: 200, body: CONTENT_A}));
    try {
      const item = await migrateGroup(provider, g, groupOpts({dryRun: true}));
      expect(item.status).toBe('dry-run');
      expect(item.sourceAvailable).toBe(true);
      expect(item.localCidMatch).toBe(true);
      expect(calls.backup).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test('backed but verify fails → pinned yet not verified', async () => {
    const g = await group();
    const {provider} = makeMockProvider({verify: () => false});
    const item = await migrateGroup(provider, g, groupOpts());
    expect(item.status).toBe('pinned');
    expect(item.verified).toBe(false);
  });
});

// ---------------- migrateToProvider (wiring) ----------------

describe('migrateToProvider', () => {
  test('enumerates, prepares once, backs up each unique CID, tallies the report', async () => {
    const client = makeMockClient({
      [`${GOV}.getProposalsCount`]: 3n,
      [`${GOV}.getProposal`]: (args: readonly unknown[]) => ({
        ipfsHash: [hash(101), ZERO, hash(103)][Number(args[0])] ?? ZERO,
      }),
    });
    const {provider, calls} = makeMockProvider({name: 'mock'});
    const report = await migrateToProvider(client, provider, silentLogger, {concurrency: 2});
    expect(report.provider).toBe('mock');
    expect(report.totalProposals).toBe(3);
    expect(report.uniqueCids).toBe(2); // id 1 has a zero hash
    expect(report.counts.noIpfs).toBe(1);
    expect(report.counts.pinned).toBe(2);
    expect(report.counts.failed).toBe(0);
    expect(calls.prepared).toBe(1); // prepare() called exactly once
    expect(calls.backup).toHaveLength(2);
  });

  test('dry-run does not prepare or back up', async () => {
    const client = makeMockClient({
      [`${GOV}.getProposalsCount`]: 2n,
      [`${GOV}.getProposal`]: (args: readonly unknown[]) => ({
        ipfsHash: [hash(201), hash(202)][Number(args[0])] ?? ZERO,
      }),
    });
    const {provider, calls} = makeMockProvider({needsContent: true});
    const {restore} = installFetchMock(() => ({status: 200, body: CONTENT_A}));
    try {
      const report = await migrateToProvider(client, provider, silentLogger, {dryRun: true});
      expect(report.counts.dryRun).toBe(2);
      expect(report.counts.pinned).toBe(0);
      expect(calls.prepared).toBe(0);
      expect(calls.backup).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
