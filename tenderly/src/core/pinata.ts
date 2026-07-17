// Thin client for the Pinata **V3** API (the legacy `/pinning/*` + `/data/*` endpoints are a
// separate permission scope; V3 keys don't have them). Auth is a Bearer JWT only. Only the
// surface the IPFS migration needs:
//   - pinByCid        — ask Pinata to fetch an existing CID off the public IPFS network and
//                       pin it, preserving the EXACT CID (the on-chain ipfsHash keeps working).
//   - uploadFileBytes — re-upload raw bytes we already hold (public network). Fallback for
//                       when pin-by-CID can't find the content on the network anymore.
//   - listFilesByCid / isPinned — has this CID been pinned to our account yet?
//   - listPinJobsByCid — in-flight pin-by-CID job status (best-effort; terminal-failure detect).
//   - fetchFromGateway — read content back through the account's dedicated gateway to prove
//                        the pin actually serves.
//
// Everything is injectable (fetch impl + base URLs) so tests never hit the network.

const DEFAULT_API_BASE = 'https://api.pinata.cloud/v3';
const DEFAULT_UPLOAD_BASE = 'https://uploads.pinata.cloud/v3';

export type PinataConfig = {
  /** V3 Bearer JWT (the long `eyJ…` token Pinata shows when you create an API key). */
  jwt: string;
  /** Dedicated gateway host, e.g. `my-gw.mypinata.cloud` (scheme/trailing slash tolerated). */
  gateway?: string;
  /** Optional access token appended as `?pinataGatewayToken=` for restricted gateways. */
  gatewayToken?: string;
  apiBase?: string;
  uploadBase?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export type PinByCidResponse = {
  id: string;
  cid: string;
  status: string;
  name?: string;
  date_queued?: string;
};
export type FileRecord = {id: string; cid: string; name?: string; size?: number};
export type UploadResponse = {id: string; cid: string; size?: number};
export type PinJobRecord = {id: string; cid: string; status: string};

export type PinataMetadataInput = {name?: string; keyvalues?: Record<string, string>};

/**
 * pin-by-CID job statuses that mean the job has permanently failed. Best-effort: V3 does not
 * publish an exhaustive enum, so anything not in here is treated as still-in-progress and we
 * fall back to the overall timeout.
 */
export const FAILED_JOB_STATUSES: ReadonlySet<string> = new Set([
  'expired',
  'over_free_limit',
  'over_max_size',
  'invalid_object',
  'bad_host_node',
  'cancelled',
  'failed',
]);

export class PinataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PinataError';
  }
}

/** A Pinata JWT is a standard JWS: three base64url segments, header starting `eyJ`. */
export const looksLikeJwt = (v: string): boolean =>
  v.startsWith('eyJ') && v.split('.').length === 3;

/**
 * Resolve Pinata config from environment. The V3 API authenticates with a Bearer JWT, so
 * `PINATA_JWT` is required and must actually look like a JWT — a common footgun is pasting the
 * api key (not the JWT) into it, which Pinata rejects with a confusing "token is malformed" 401.
 */
export const resolvePinataConfig = (env: NodeJS.ProcessEnv = process.env): PinataConfig => {
  const jwt = env.PINATA_JWT?.trim();
  const hasKeySecret = Boolean(
    (env.PINATA_API_KEY ?? env.PINATA_KEY)?.trim() &&
    (env.PINATA_API_SECRET ?? env.PINATA_SECRET)?.trim(),
  );

  if (!jwt) {
    throw new PinataError(
      hasKeySecret
        ? 'The V3 Pinata API needs a JWT, not an api-key/secret. Set PINATA_JWT to the JWT ' +
            'shown when you created the key (the long `eyJ…` string).'
        : 'PINATA_JWT missing — set it to your Pinata V3 API JWT in .env',
    );
  }
  if (!looksLikeJwt(jwt)) {
    throw new PinataError(
      'PINATA_JWT does not look like a JWT (expected `eyJ…` with 3 dot-separated segments). ' +
        'Copy the JWT (not the api key or secret) from the Pinata key you created.',
    );
  }

  return {
    jwt,
    gateway: env.PINATA_GATEWAY?.trim() || undefined,
    gatewayToken: env.PINATA_GATEWAY_KEY?.trim() || undefined,
  };
};

/** Normalize a gateway env value (`https://x/`, `x`, `x/`) to a bare host. */
export const normalizeGatewayHost = (raw: string): string =>
  raw
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .trim();

export type PinataClient = ReturnType<typeof createPinataClient>;

export const createPinataClient = (config: PinataConfig) => {
  const apiBase = config.apiBase ?? DEFAULT_API_BASE;
  const uploadBase = config.uploadBase ?? DEFAULT_UPLOAD_BASE;
  const doFetch = config.fetchImpl ?? fetch;
  const authHeader = {Authorization: `Bearer ${config.jwt}`};

  const readJson = async <T>(res: Response): Promise<T> => {
    const text = await res.text();
    if (!res.ok) {
      // Body only — never the request headers (which carry the JWT).
      throw new PinataError(`Pinata ${res.status}: ${text.slice(0, 500)}`, res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PinataError(`Pinata returned non-JSON body: ${text.slice(0, 200)}`, res.status);
    }
  };

  /** POST /v3/files/public/pin_by_cid — pin an existing public-network CID, preserving it. */
  const pinByCid = async (
    cid: string,
    opts: {metadata?: PinataMetadataInput; hostNodes?: string[]} = {},
  ): Promise<PinByCidResponse> => {
    const body: Record<string, unknown> = {cid};
    if (opts.metadata?.name) body.name = opts.metadata.name;
    if (opts.metadata?.keyvalues) body.keyvalues = opts.metadata.keyvalues;
    if (opts.hostNodes?.length) body.host_nodes = opts.hostNodes;
    const res = await doFetch(`${apiBase}/files/public/pin_by_cid`, {
      method: 'POST',
      headers: {...authHeader, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const json = await readJson<{data: PinByCidResponse}>(res);
    return json.data;
  };

  /**
   * POST (uploads host) /v3/files — re-upload raw bytes to the public network. Callers MUST
   * verify the returned `cid` equals the expected CID before trusting it.
   */
  const uploadFileBytes = async (
    bytes: Uint8Array,
    opts: {fileName?: string; metadata?: PinataMetadataInput} = {},
  ): Promise<UploadResponse> => {
    const form = new FormData();
    form.append('file', new Blob([bytes]), opts.fileName ?? 'proposal.md');
    form.append('network', 'public');
    if (opts.metadata?.name) form.append('name', opts.metadata.name);
    if (opts.metadata?.keyvalues) form.append('keyvalues', JSON.stringify(opts.metadata.keyvalues));
    const res = await doFetch(`${uploadBase}/files`, {
      method: 'POST',
      headers: authHeader, // let fetch set the multipart Content-Type + boundary
      body: form,
    });
    const json = await readJson<{data: UploadResponse}>(res);
    return json.data;
  };

  /** GET /v3/files/public?cid=… — pinned files whose CID matches exactly. */
  const listFilesByCid = async (cid: string): Promise<FileRecord[]> => {
    const url = `${apiBase}/files/public?cid=${encodeURIComponent(cid)}`;
    const res = await doFetch(url, {headers: authHeader});
    const json = await readJson<{data?: {files?: FileRecord[]}}>(res);
    return (json.data?.files ?? []).filter((f) => f.cid === cid);
  };

  const isPinned = async (cid: string): Promise<boolean> => (await listFilesByCid(cid)).length > 0;

  /** DELETE /v3/files/public/{id} — remove (unpin) a file by its record id. 404 = already gone. */
  const deleteFile = async (id: string): Promise<void> => {
    const res = await doFetch(`${apiBase}/files/public/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    if (!res.ok && res.status !== 404) {
      throw new PinataError(
        `delete ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    }
  };

  /** GET /v3/files/public/pin_by_cid?cid=… — in-flight pin-by-CID jobs. Best-effort. */
  const listPinJobsByCid = async (cid: string): Promise<PinJobRecord[]> => {
    try {
      const url = `${apiBase}/files/public/pin_by_cid?cid=${encodeURIComponent(cid)}`;
      const res = await doFetch(url, {headers: authHeader});
      const json = await readJson<{data?: {jobs?: PinJobRecord[]; rows?: PinJobRecord[]}}>(res);
      const rows = json.data?.jobs ?? json.data?.rows ?? [];
      return rows.filter((r) => r.cid === cid);
    } catch {
      return []; // job-status is advisory; never let it break the migration
    }
  };

  const gatewayUrl = (cid: string): string => {
    if (!config.gateway) throw new PinataError('no PINATA_GATEWAY configured');
    const host = normalizeGatewayHost(config.gateway);
    const suffix = config.gatewayToken
      ? `?pinataGatewayToken=${encodeURIComponent(config.gatewayToken)}`
      : '';
    return `https://${host}/ipfs/${cid}${suffix}`;
  };

  /** Fetch content back through the dedicated gateway. Returns text, or throws on non-2xx. */
  const fetchFromGateway = async (cid: string, timeoutMs = 15_000): Promise<string> => {
    const res = await doFetch(gatewayUrl(cid), {signal: AbortSignal.timeout(timeoutMs)});
    if (!res.ok) throw new PinataError(`gateway ${res.status} for ${cid}`, res.status);
    return res.text();
  };

  return {
    config,
    pinByCid,
    uploadFileBytes,
    listFilesByCid,
    listPinJobsByCid,
    isPinned,
    deleteFile,
    gatewayUrl,
    fetchFromGateway,
  };
};
