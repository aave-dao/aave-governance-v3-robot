// Low-level client for Filebase's S3-compatible API (used to back proposals up to IPFS on a
// second, independent provider for redundancy). Filebase pins each uploaded object to IPFS and
// returns the assigned CID in the `x-amz-meta-cid` response header. For single-block files
// (every Aave proposal doc) it produces the SAME CIDv0 as the on-chain ipfsHash — verified
// empirically — so a plain S3 PUT preserves the exact hash.
//
// Auth is AWS SigV4 over the access-key/secret pair. Signing is delegated to a `SignedFetch`
// (aws4fetch in production) so tests can inject a stub and never sign/network.

import {AwsClient} from 'aws4fetch';

/** A `fetch` that AWS-SigV4-signs the request. Injectable for tests. */
export type SignedFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type FilebaseConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  /** S3 endpoint, e.g. https://s3.filebase.io */
  endpoint: string;
  /** IPFS bucket to store objects in (created on demand if missing). */
  bucket: string;
  signedFetch?: SignedFetch;
};

export class FilebaseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FilebaseError';
  }
}

export const DEFAULT_FILEBASE_ENDPOINT = 'https://s3.filebase.io';
export const DEFAULT_FILEBASE_BUCKET = 'aave-gov-v3-proposals';

/** Resolve Filebase config from env. Throws if the access key/secret are missing. */
export const resolveFilebaseConfig = (env: NodeJS.ProcessEnv = process.env): FilebaseConfig => {
  const accessKeyId = env.FILEBASE_ACCESS_TOKEN?.trim();
  const secretAccessKey = env.FILEBASE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new FilebaseError(
      'Filebase credentials missing — set FILEBASE_ACCESS_TOKEN and FILEBASE_SECRET_KEY in .env',
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: (env.FILEBASE_API_ENDPOINT?.trim() || DEFAULT_FILEBASE_ENDPOINT).replace(/\/+$/, ''),
    bucket: env.FILEBASE_BUCKET?.trim() || DEFAULT_FILEBASE_BUCKET,
  };
};

/** Build a SigV4-signing fetch from a key/secret (Filebase uses the us-east-1 region). */
export const makeSignedFetch = (accessKeyId: string, secretAccessKey: string): SignedFetch => {
  const aws = new AwsClient({accessKeyId, secretAccessKey, service: 's3', region: 'us-east-1'});
  return (url, init) => aws.fetch(url, init);
};

export type FilebaseObjectMeta = {proposalIds?: string; ipfsHash?: string};

export type FilebaseClient = ReturnType<typeof createFilebaseClient>;

export const createFilebaseClient = (config: FilebaseConfig) => {
  const base = config.endpoint;
  const bucket = config.bucket;
  const signed = config.signedFetch ?? makeSignedFetch(config.accessKeyId, config.secretAccessKey);

  /** One object per CID, under a stable prefix. Key content is arbitrary; the CID drives IPFS. */
  const objectKey = (cid: string): string => `proposals/${cid}`;
  const objectUrl = (cid: string): string =>
    `${base}/${bucket}/${objectKey(cid).split('/').map(encodeURIComponent).join('/')}`;

  /** Create the IPFS bucket if it doesn't already exist. Idempotent. */
  const ensureBucket = async (): Promise<void> => {
    const head = await signed(`${base}/${bucket}`, {method: 'HEAD'});
    if (head.ok) return;
    if (head.status !== 404) {
      // 403 can also mean "exists but not ours"; surface anything unexpected.
      throw new FilebaseError(`bucket ${bucket} check failed: ${head.status}`, head.status);
    }
    const mk = await signed(`${base}/${bucket}`, {
      method: 'PUT',
      headers: {'x-amz-meta-network': 'ipfs'}, // create on the IPFS network
    });
    if (!mk.ok) {
      throw new FilebaseError(
        `create bucket ${bucket}: ${mk.status} ${(await mk.text()).slice(0, 200)}`,
        mk.status,
      );
    }
  };

  /** HEAD the object for `cid`; returns its stored IPFS CID, or null if the object is absent. */
  const headCid = async (cid: string): Promise<string | null> => {
    const res = await signed(objectUrl(cid), {method: 'HEAD'});
    if (res.status === 404) return null;
    if (!res.ok) throw new FilebaseError(`head ${cid}: ${res.status}`, res.status);
    return res.headers.get('x-amz-meta-cid');
  };

  /** PUT content; returns the CID Filebase assigned (from `x-amz-meta-cid`). */
  const putContent = async (
    cid: string,
    bytes: Uint8Array,
    meta: FilebaseObjectMeta = {},
  ): Promise<string | null> => {
    const headers: Record<string, string> = {'Content-Type': 'text/markdown'};
    if (meta.proposalIds) headers['x-amz-meta-proposalids'] = meta.proposalIds;
    if (meta.ipfsHash) headers['x-amz-meta-ipfshash'] = meta.ipfsHash;
    const res = await signed(objectUrl(cid), {method: 'PUT', body: bytes, headers});
    if (!res.ok) {
      throw new FilebaseError(
        `put ${cid}: ${res.status} ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    }
    return res.headers.get('x-amz-meta-cid');
  };

  return {config, objectKey, objectUrl, ensureBucket, headCid, putContent};
};
