// Provider abstraction for backing up a proposal's IPFS document to a pinning service while
// preserving the EXACT on-chain CIDv0. The migration engine is written against `BackupProvider`
// and runs each configured provider as an independent sweep (Pinata, then Filebase, …) so a
// new backend is added by implementing this interface — no engine changes.

import {computeCidV0FromText, MAX_SINGLE_BLOCK_BYTES} from './ipfs';
import type {FilebaseClient} from './filebase';
import type {Logger} from './logger';
import {FAILED_JOB_STATUSES, type PinataClient} from './pinata';

export type BackupMeta = {proposalIds: bigint[]; ipfsHash: string};

export type BackupOutcome = {
  /** `backed` = confirmed on this provider; `pending` = async job queued (re-run to confirm). */
  status: 'backed' | 'pending' | 'failed';
  method: string;
  reason?: string;
};

export type UnpinOutcome = {
  /** `unpinned` = removed from the account; `not-present` = wasn't there; `failed` = errored. */
  status: 'unpinned' | 'not-present' | 'failed';
  /** How many objects/pins were removed (a CID can back multiple file records on Pinata). */
  count?: number;
  reason?: string;
};

export interface BackupProvider {
  readonly name: string;
  /** Does `backup` require the raw content bytes? Upload-based providers (Filebase) do. */
  readonly needsContent: boolean;
  /** One-time setup before a sweep (e.g. create the bucket). Optional. */
  prepare?(): Promise<void>;
  /** Already backed on this provider (checked against the account), preserving the CID. */
  isBacked(cid: string): Promise<boolean>;
  /** Back up an existing CID, preserving it exactly. */
  backup(
    cid: string,
    ctx: {content?: Uint8Array; contentMatchesCid?: boolean; meta: BackupMeta},
  ): Promise<BackupOutcome>;
  /** Independent post-backup verification that the CID is stored/retrievable on this provider. */
  verify(cid: string): Promise<boolean>;
  /** Remove (unpin) a CID from THIS account. No-op (`not-present`) if it isn't there. */
  unpin(cid: string): Promise<UnpinOutcome>;
}

const metaName = (meta: BackupMeta) =>
  `aave-gov-proposal-${meta.proposalIds.map(String).join('_')}`;
const metaKeyvalues = (meta: BackupMeta) => ({
  proposalIds: meta.proposalIds.map(String).join(','),
  ipfsHash: meta.ipfsHash,
  source: 'aave-gov-v3-robot-migration',
});

// -------------------- Pinata --------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until Pinata reports `cid` pinned. Breaks early on a terminal pinJobs failure so the
 * caller can react without waiting out the whole timeout.
 */
const waitUntilPinned = async (
  pinata: PinataClient,
  cid: string,
  opts: {timeoutMs: number; pollIntervalMs: number; logger: Logger},
): Promise<{pinned: boolean; terminalStatus?: string; timedOut?: boolean}> => {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (await pinata.isPinned(cid)) return {pinned: true};
    const jobs = await pinata.listPinJobsByCid(cid);
    const failed = jobs.find((j) => FAILED_JOB_STATUSES.has(j.status));
    if (failed) {
      opts.logger.warn('pinata: pin-by-cid job failed', {cid, status: failed.status});
      return {pinned: false, terminalStatus: failed.status};
    }
    if (Date.now() >= deadline) return {pinned: false, timedOut: true};
    await sleep(opts.pollIntervalMs);
  }
};

/** Re-fetch through the dedicated Pinata gateway and re-verify the CID. */
const verifyPinataGateway = async (
  pinata: PinataClient,
  cid: string,
  logger: Logger,
): Promise<boolean> => {
  if (!pinata.config.gateway) return false;
  try {
    const text = await pinata.fetchFromGateway(cid);
    if (new TextEncoder().encode(text).length <= MAX_SINGLE_BLOCK_BYTES) {
      if ((await computeCidV0FromText(text)) !== cid) {
        logger.warn('pinata: gateway served content not matching CID', {cid});
        return false;
      }
    } else if (text.length === 0) {
      return false;
    }
    return true;
  } catch (e) {
    logger.warn('pinata: gateway re-fetch failed', {
      cid,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
};

export type PinataProviderOptions = {
  verifyViaGateway: boolean;
  allowReupload: boolean;
  pinTimeoutMs: number;
  pollIntervalMs: number;
  logger: Logger;
};

export const makePinataProvider = (
  pinata: PinataClient,
  opts: PinataProviderOptions,
): BackupProvider => ({
  name: 'pinata',
  // Content is only needed for the (opt-in, legacy-only) re-upload fallback.
  needsContent: opts.allowReupload,

  isBacked: (cid) => pinata.isPinned(cid),

  backup: async (cid, ctx) => {
    // A prior run may already have queued an async pin-by-cid job — don't re-queue it.
    const inflight = (await pinata.listPinJobsByCid(cid)).find(
      (j) => !FAILED_JOB_STATUSES.has(j.status),
    );
    if (inflight)
      return {status: 'pending', method: 'pin-by-cid', reason: `pin-by-cid ${inflight.status}`};

    let terminal = false;
    let reason: string | undefined;
    try {
      await pinata.pinByCid(cid, {
        metadata: {name: metaName(ctx.meta), keyvalues: metaKeyvalues(ctx.meta)},
      });
      const res = await waitUntilPinned(pinata, cid, {
        timeoutMs: opts.pinTimeoutMs,
        pollIntervalMs: opts.pollIntervalMs,
        logger: opts.logger,
      });
      if (res.pinned) return {status: 'backed', method: 'pin-by-cid'};
      if (res.terminalStatus) {
        terminal = true;
        reason = `pin-by-cid ${res.terminalStatus}`;
      } else {
        return {
          status: 'pending',
          method: 'pin-by-cid',
          reason: 'queued; not yet confirmed — re-run to verify',
        };
      }
    } catch (e) {
      reason = `pinByCid error: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Last-resort re-upload after a TERMINAL failure, opt-in only. Pinata's V3 upload emits a
    // CIDv1 that can't equal the on-chain CIDv0, so this only helps with a legacy-capable key.
    if (opts.allowReupload && terminal && ctx.content && ctx.contentMatchesCid) {
      try {
        const res = await pinata.uploadFileBytes(ctx.content, {
          fileName: `${cid}.md`,
          metadata: {name: metaName(ctx.meta), keyvalues: metaKeyvalues(ctx.meta)},
        });
        if (res.cid === cid) return {status: 'backed', method: 're-upload'};
        reason = `re-upload produced ${res.cid}, expected ${cid} (upload can't reproduce CIDv0)`;
      } catch (e) {
        reason = `re-upload error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return {status: 'failed', method: 'pin-by-cid', reason};
  },

  verify: async (cid) => {
    if (opts.verifyViaGateway && pinata.config.gateway) {
      return verifyPinataGateway(pinata, cid, opts.logger);
    }
    try {
      return await pinata.isPinned(cid);
    } catch {
      return false;
    }
  },

  unpin: async (cid) => {
    try {
      // A CID can back more than one file record on the account — remove them all.
      const files = await pinata.listFilesByCid(cid);
      if (files.length === 0) return {status: 'not-present'};
      for (const f of files) await pinata.deleteFile(f.id);
      return {status: 'unpinned', count: files.length};
    } catch (e) {
      return {status: 'failed', reason: e instanceof Error ? e.message : String(e)};
    }
  },
});

// -------------------- Filebase --------------------

export type FilebaseProviderOptions = {logger: Logger};

export const makeFilebaseProvider = (
  filebase: FilebaseClient,
  opts: FilebaseProviderOptions,
): BackupProvider => ({
  name: 'filebase',
  needsContent: true, // S3 upload — we must supply the bytes

  prepare: () => filebase.ensureBucket(),

  isBacked: async (cid) => {
    try {
      return (await filebase.headCid(cid)) === cid;
    } catch {
      return false;
    }
  },

  backup: async (cid, ctx) => {
    if (!ctx.content) {
      return {status: 'failed', method: 's3-upload', reason: 'content not retrievable to upload'};
    }
    if (ctx.contentMatchesCid === false) {
      return {status: 'failed', method: 's3-upload', reason: 'fetched bytes do not match CID'};
    }
    try {
      const got = await filebase.putContent(cid, ctx.content, {
        proposalIds: ctx.meta.proposalIds.map(String).join(','),
        ipfsHash: ctx.meta.ipfsHash,
      });
      if (got === cid) return {status: 'backed', method: 's3-upload'};
      return {
        status: 'failed',
        method: 's3-upload',
        reason: `filebase produced ${got ?? 'null'}, expected ${cid}`,
      };
    } catch (e) {
      opts.logger.warn('filebase: upload failed', {
        cid,
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        status: 'failed',
        method: 's3-upload',
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  },

  // HEAD the stored object and confirm Filebase reports the exact CID — account-side proof,
  // independent of any gateway.
  verify: async (cid) => {
    try {
      return (await filebase.headCid(cid)) === cid;
    } catch {
      return false;
    }
  },

  unpin: async (cid) => {
    try {
      if ((await filebase.headCid(cid)) !== cid) return {status: 'not-present'};
      await filebase.deleteObject(cid);
      return {status: 'unpinned', count: 1};
    } catch (e) {
      return {status: 'failed', reason: e instanceof Error ? e.message : String(e)};
    }
  },
});
