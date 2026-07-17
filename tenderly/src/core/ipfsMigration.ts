// Provider-generic migration: back up every mainnet Aave Governance V3 proposal's IPFS
// document to one or more pinning providers, preserving the on-chain `ipfsHash` (CIDv0) so it
// keeps resolving after the current host unpins them.
//
// The engine is agnostic to the backend — it works against a `BackupProvider` (see
// providers.ts) and runs one full sweep per provider (Pinata, then Filebase, …). Per CID:
//   1. Read `ipfsHash` from the L1 governance contract (source of truth for the CID).
//   2. If already backed on this provider → verify + skip.
//   3. If the provider needs the bytes (upload-based), fetch from public gateways and confirm
//      they hash to the expected CID (`computeCidV0FromText`) — catches a gateway 200 error page.
//   4. Ask the provider to back up the CID (preserving it), then verify.
//
// The on-chain hash is authoritative throughout: nothing is accepted under a different CID.

import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address, Hex, PublicClient} from 'viem';
import {governanceAbi} from './abis';
import {GOVERNANCE_CHAIN_ID} from './chains';
import {
  computeCidV0FromText,
  fetchIpfsText,
  ipfsHashToCidV0,
  MAX_SINGLE_BLOCK_BYTES,
  type FetchIpfsOptions,
} from './ipfs';
import type {Logger} from './logger';
import type {BackupProvider} from './providers';

const ZERO_HASH = ('0x' + '00'.repeat(32)) as Hex;

export type ProposalCidGroup = {
  cid: string;
  ipfsHash: Hex;
  /** All proposals that reference this CID (usually one, but hashes can repeat). */
  proposalIds: bigint[];
};

export type CollectResult = {
  totalProposals: number;
  scannedFrom: number;
  scannedTo: number;
  groups: ProposalCidGroup[];
  /** Proposal ids with a zero ipfsHash — nothing to back up. */
  noIpfsProposalIds: bigint[];
};

export type MigrationStatus =
  | 'pinned' // newly backed this run
  | 'already-pinned' // was already on the provider
  | 'pending' // async job queued but not yet confirmed (re-run to check)
  | 'dry-run' // would back up (dry run)
  | 'failed'; // could not back it

export type MigrationItem = {
  cid: string;
  ipfsHash: Hex;
  proposalIds: bigint[];
  status: MigrationStatus;
  /** How it was backed: provider-defined, e.g. 'pin-by-cid', 's3-upload', 'already-backed'. */
  method: string;
  /** Content was retrievable from a public gateway (only fetched when the provider needs it). */
  sourceAvailable: boolean;
  /** Byte length of the fetched document, when available. */
  contentBytes?: number;
  /** Recomputed CID from the fetched bytes equals the on-chain-derived CID. */
  localCidMatch?: boolean;
  /** Provider reports the CID as backed (present against the account). */
  pinned: boolean;
  /** Independent post-backup verification passed (provider-defined; account- or gateway-based). */
  verified: boolean;
  /** Human-readable detail for failures / warnings. */
  reason?: string;
};

export type MigrationReport = CollectResult & {
  provider: string;
  uniqueCids: number;
  items: MigrationItem[];
  counts: {
    pinned: number;
    alreadyPinned: number;
    reUploaded: number;
    pending: number;
    failed: number;
    dryRun: number;
    noIpfs: number;
    verified: number;
  };
};

export type MigrateOptions = {
  from?: number;
  to?: number;
  concurrency?: number;
  dryRun?: boolean;
  /** Override source gateways for the content fetch (defaults to ipfs.ts DEFAULT_GATEWAYS). */
  sourceGateways?: string[];
};

/** Run `fn` over `items` with at most `limit` concurrent executions, preserving order. */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({length: Math.max(1, Math.min(limit, items.length))}, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Enumerate proposals `[from..to]` (defaults to the full history 0..count-1), read each
 * `ipfsHash`, and group by derived CID. Zero-hash proposals are collected separately.
 */
export const collectProposalCids = async (
  client: PublicClient,
  opts: {from?: number; to?: number; concurrency?: number; logger?: Logger} = {},
): Promise<CollectResult> => {
  const gov = GovernanceV3Ethereum.GOVERNANCE as Address;
  const total = Number(
    (await client.readContract({
      address: gov,
      abi: governanceAbi,
      functionName: 'getProposalsCount',
    })) as bigint,
  );

  if (total === 0) {
    return {totalProposals: 0, scannedFrom: 0, scannedTo: -1, groups: [], noIpfsProposalIds: []};
  }

  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(opts.to ?? total - 1, total - 1);
  opts.logger?.info('collect: scanning proposals', {total, from, to});

  const ids: bigint[] = [];
  for (let i = from; i <= to; i++) ids.push(BigInt(i));

  const hashes = await mapWithConcurrency(ids, opts.concurrency ?? 8, async (id) => {
    const p = (await client.readContract({
      address: gov,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [id],
    })) as {ipfsHash: Hex};
    return {id, ipfsHash: p.ipfsHash};
  });

  const byCid = new Map<string, ProposalCidGroup>();
  const noIpfsProposalIds: bigint[] = [];
  for (const {id, ipfsHash} of hashes) {
    if (!ipfsHash || ipfsHash === ZERO_HASH) {
      noIpfsProposalIds.push(id);
      continue;
    }
    const cid = ipfsHashToCidV0(ipfsHash);
    const existing = byCid.get(cid);
    if (existing) existing.proposalIds.push(id);
    else byCid.set(cid, {cid, ipfsHash, proposalIds: [id]});
  }

  return {
    totalProposals: total,
    scannedFrom: from,
    scannedTo: to,
    groups: [...byCid.values()],
    noIpfsProposalIds,
  };
};

/** Fetch content and verify it hashes to the expected CID. Never throws. */
const fetchAndVerifySource = async (
  cid: string,
  fetchOpts: FetchIpfsOptions | undefined,
  logger: Logger,
): Promise<{text?: string; localCidMatch?: boolean; reason?: string}> => {
  let text: string;
  try {
    text = await fetchIpfsText(cid, fetchOpts);
  } catch (e) {
    const reason = `source unavailable: ${e instanceof Error ? e.message : String(e)}`;
    logger.warn('migrate: source content not found on public gateways', {cid, reason});
    return {reason};
  }
  // Files above one block can't be locally re-hashed with the single-block algo; trust the
  // gateway's own content-addressing for those (Aave proposals are always well under this).
  if (new TextEncoder().encode(text).length > MAX_SINGLE_BLOCK_BYTES) {
    return {text};
  }
  const recomputed = await computeCidV0FromText(text);
  const localCidMatch = recomputed === cid;
  if (!localCidMatch) {
    logger.warn('migrate: fetched content does NOT hash to on-chain CID — not trusting bytes', {
      cid,
      recomputed,
    });
  }
  return {text, localCidMatch};
};

export type MigrateGroupOptions = {
  dryRun: boolean;
  sourceGateways?: string[];
  logger: Logger;
};

/** Back up a single CID group to one provider. Never throws — failures become MigrationItems. */
export const migrateGroup = async (
  provider: BackupProvider,
  group: ProposalCidGroup,
  opts: MigrateGroupOptions,
): Promise<MigrationItem> => {
  const {cid, ipfsHash, proposalIds} = group;
  const logger = opts.logger.child({
    provider: provider.name,
    cid,
    proposalIds: proposalIds.map(String).join(','),
  });
  const base: MigrationItem = {
    cid,
    ipfsHash,
    proposalIds,
    status: 'failed',
    method: 'none',
    sourceAvailable: false,
    pinned: false,
    verified: false,
  };

  // Skip check FIRST: already backed on this provider? A failed check (transient API error, or
  // a credential-less --dry-run) is non-fatal — log and fall through; backup is idempotent.
  let alreadyBacked = false;
  try {
    alreadyBacked = await provider.isBacked(cid);
  } catch (e) {
    logger.warn('migrate: backed-check failed; continuing', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (alreadyBacked) {
    const verified = await provider.verify(cid);
    logger.info('migrate: already backed — skipping', {verified});
    return {...base, status: 'already-pinned', method: 'already-backed', pinned: true, verified};
  }

  // Fetch the document only when the provider needs the bytes (upload-based backends).
  let content: Uint8Array | undefined;
  let sourceAvailable = false;
  let contentBytes: number | undefined;
  let localCidMatch: boolean | undefined;
  if (provider.needsContent) {
    const fetchOpts = opts.sourceGateways ? {gateways: opts.sourceGateways} : undefined;
    const src = await fetchAndVerifySource(cid, fetchOpts, logger);
    sourceAvailable = src.text !== undefined;
    localCidMatch = src.localCidMatch;
    if (src.text !== undefined) {
      content = new TextEncoder().encode(src.text);
      contentBytes = content.length;
    }
  }

  if (opts.dryRun) {
    logger.info('migrate: dry-run (would back up)', {sourceAvailable, localCidMatch});
    return {...base, status: 'dry-run', sourceAvailable, contentBytes, localCidMatch};
  }

  const outcome = await provider.backup(cid, {
    content,
    contentMatchesCid: localCidMatch,
    meta: {proposalIds, ipfsHash},
  });
  const pinned = outcome.status === 'backed';
  const status: MigrationStatus = pinned
    ? 'pinned'
    : outcome.status === 'pending'
      ? 'pending'
      : 'failed';
  const verified = pinned ? await provider.verify(cid) : false;

  if (pinned) logger.info('migrate: backed', {method: outcome.method, verified});
  else if (status === 'pending')
    logger.warn('migrate: queued, not yet confirmed', {reason: outcome.reason});
  else logger.error('migrate: FAILED to back proposal content', {reason: outcome.reason});

  return {
    ...base,
    status,
    method: outcome.method,
    sourceAvailable,
    contentBytes,
    localCidMatch,
    pinned,
    verified,
    reason: outcome.reason,
  };
};

/** Full migration to a single provider: enumerate → back up → verify every historic proposal. */
export const migrateToProvider = async (
  client: PublicClient,
  provider: BackupProvider,
  logger: Logger,
  options: MigrateOptions = {},
): Promise<MigrationReport> => {
  const collected = await collectProposalCids(client, {
    from: options.from,
    to: options.to,
    concurrency: options.concurrency,
    logger,
  });

  logger.info('migrate: starting', {
    provider: provider.name,
    uniqueCids: collected.groups.length,
    noIpfs: collected.noIpfsProposalIds.length,
    dryRun: options.dryRun ?? false,
  });

  if (!options.dryRun && provider.prepare) await provider.prepare();

  const perGroupOpts: MigrateGroupOptions = {
    dryRun: options.dryRun ?? false,
    sourceGateways: options.sourceGateways,
    logger,
  };

  const items = await mapWithConcurrency(collected.groups, options.concurrency ?? 5, (group) =>
    migrateGroup(provider, group, perGroupOpts),
  );

  const counts = {
    pinned: items.filter((i) => i.status === 'pinned').length,
    alreadyPinned: items.filter((i) => i.status === 'already-pinned').length,
    reUploaded: items.filter((i) => i.method === 're-upload').length,
    pending: items.filter((i) => i.status === 'pending').length,
    failed: items.filter((i) => i.status === 'failed').length,
    dryRun: items.filter((i) => i.status === 'dry-run').length,
    noIpfs: collected.noIpfsProposalIds.length,
    verified: items.filter((i) => i.verified).length,
  };

  logger.info('migrate: done', {provider: provider.name, ...counts});
  return {
    ...collected,
    provider: provider.name,
    uniqueCids: collected.groups.length,
    items,
    counts,
  };
};

export {GOVERNANCE_CHAIN_ID};
