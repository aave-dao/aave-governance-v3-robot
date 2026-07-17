import type {Hex} from 'viem';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Standard base58 encode (Bitcoin/IPFS alphabet). Inlined to avoid a `bs58` dep. */
const base58Encode = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '';
  // Big-int division is the simplest correct impl. Buffers in Aave proposals are 34 bytes.
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n /= 58n;
    out = BASE58_ALPHABET[r] + out;
  }
  // Preserve leading-zero bytes as leading '1's per base58btc.
  for (const b of bytes) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
};

/**
 * Convert the bytes32 ipfsHash stored on-chain to a CIDv0 string.
 * CIDv0 is base58btc(0x1220 || sha2-256-digest) — Aave only stores the 32-byte digest,
 * so we prepend the multihash prefix (0x12 = sha2-256, 0x20 = 32 bytes).
 */
export const ipfsHashToCidV0 = (ipfsHash: Hex): string => {
  const hex = ipfsHash.startsWith('0x') ? ipfsHash.slice(2) : ipfsHash;
  if (hex.length !== 64) throw new Error(`ipfsHash must be 32 bytes, got ${hex.length / 2}`);
  const bytes = new Uint8Array(34);
  bytes[0] = 0x12;
  bytes[1] = 0x20;
  for (let i = 0; i < 32; i++) bytes[i + 2] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return base58Encode(bytes);
};

// -------- content-address verification (bytes → CIDv0) --------
//
// The inverse-ish of ipfsHashToCidV0 at the CONTENT level: given the raw bytes of a
// proposal doc, recompute the CIDv0 the IPFS protocol assigns to it. Used by the Pinata
// migration to prove that what a gateway served us actually hashes to the on-chain
// ipfsHash (a gateway returning a 200 with an HTML error page would otherwise sail
// through), and to guarantee a re-upload lands under the exact expected CID.
//
// This implements the go-ipfs default for a SINGLE-BLOCK UnixFS file:
//   CIDv0 = base58btc( 0x1220 || sha256( dag-pb( unixfs-file(bytes) ) ) )
// Files ≤ 256 KiB (every Aave proposal markdown) are a single block. Larger inputs would
// be split into a balanced DAG with a different root hash — callers must treat a mismatch
// on a >256 KiB input as "can't verify locally", not "corrupt" (see MAX_SINGLE_BLOCK).

/** go-ipfs default chunk size. Inputs above this are multi-block and can't be verified here. */
export const MAX_SINGLE_BLOCK_BYTES = 256 * 1024;

/** Minimal protobuf unsigned-varint encoder (LEB128). Sizes here are always well within 2^53. */
const putUvarint = (out: number[], value: number): void => {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
};

/**
 * Wrap raw file bytes in the UnixFS `Data` message then the dag-pb `PBNode`, matching what
 * `ipfs add` produces for a single-block file. Field layout:
 *   UnixFS Data: field 1 (Type, varint) = 2 (File); field 2 (Data, bytes) if non-empty;
 *                field 3 (filesize, varint) = byte length.
 *   PBNode:      field 1 (Data, bytes) = the UnixFS message; no Links for a single block.
 */
const dagPbSingleBlock = (bytes: Uint8Array): Uint8Array => {
  const unixfs: number[] = [0x08, 0x02]; // Type = File
  if (bytes.length > 0) {
    unixfs.push(0x12); // field 2 (Data), wire type 2 (length-delimited)
    putUvarint(unixfs, bytes.length);
    for (const b of bytes) unixfs.push(b);
  }
  unixfs.push(0x18); // field 3 (filesize), wire type 0 (varint)
  putUvarint(unixfs, bytes.length);

  const node: number[] = [0x0a]; // field 1 (Data), wire type 2
  putUvarint(node, unixfs.length);
  for (const b of unixfs) node.push(b);
  return Uint8Array.from(node);
};

/**
 * Recompute the single-block CIDv0 for a piece of content. Async because it uses the Web
 * Crypto SHA-256 (available in Bun/Node ≥18 and the browser bundle alike — no node:crypto
 * import that would break the esbuild browser build).
 *
 * Throws for inputs larger than a single IPFS block, since the balanced-DAG hash for those
 * differs and this function would confidently return the wrong CID.
 */
export const computeCidV0FromBytes = async (bytes: Uint8Array): Promise<string> => {
  if (bytes.length > MAX_SINGLE_BLOCK_BYTES) {
    throw new Error(
      `content is ${bytes.length} bytes (> ${MAX_SINGLE_BLOCK_BYTES} single-block limit); ` +
        'cannot verify CIDv0 locally',
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', dagPbSingleBlock(bytes)));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return ipfsHashToCidV0(`0x${hex}` as Hex);
};

/** Convenience: recompute the CIDv0 for a UTF-8 text doc (proposal markdown). */
export const computeCidV0FromText = async (text: string): Promise<string> =>
  computeCidV0FromBytes(new TextEncoder().encode(text));

/** Aave proposal metadata — extracted from the YAML frontmatter of the IPFS markdown doc. */
export type ProposalMetadata = {
  title?: string;
  author?: string;
  discussions?: string;
  shortDescription?: string;
  /** Markdown body (after the frontmatter). */
  body: string;
  /** Original markdown text (frontmatter + body). */
  raw: string;
};

/**
 * Parse an Aave proposal markdown doc. The frontmatter is YAML between two `---` lines:
 *   ---
 *   title: "..."
 *   author: "..."
 *   discussions: https://...
 *   ---
 *   <markdown body>
 *
 * Real proposals occasionally use multi-line YAML strings or list-style author entries —
 * we support the common single-line `key: value` shape and unquote leading/trailing quotes.
 * Any field we can't extract is left undefined and the caller falls back to `<failed to load>`.
 */
export const parseProposalMarkdown = (raw: string): ProposalMetadata => {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) return {body: raw, raw};

  const [, fmBlock, body] = fmMatch as [string, string, string];
  const fields: Record<string, string> = {};
  let currentKey: string | undefined;
  let multiline = '';

  for (const line of fmBlock.split('\n')) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      if (currentKey && multiline) {
        fields[currentKey] = multiline.trim();
        multiline = '';
      }
      currentKey = kv[1]!;
      const v = (kv[2] ?? '').trim();
      fields[currentKey] = stripQuotes(v);
    } else if (currentKey && line.trim().length > 0) {
      multiline += (multiline ? ' ' : '') + line.trim().replace(/^[-*]\s*/, '');
      fields[currentKey] = stripQuotes(multiline);
    }
  }

  return {
    title: fields['title'],
    author: fields['author'],
    discussions: fields['discussions'],
    shortDescription:
      fields['shortDescription'] ?? fields['short-description'] ?? fields['summary'],
    body: body ?? '',
    raw,
  };
};

const stripQuotes = (s: string): string => {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1);
  }
  return s;
};

const DEFAULT_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs',
  'https://ipfs.io/ipfs',
  'https://gateway.pinata.cloud/ipfs',
];

export type FetchIpfsOptions = {
  gateways?: string[];
  timeoutMs?: number;
};

/** Fetch an IPFS doc as text, trying multiple gateways. */
export const fetchIpfsText = async (cid: string, opts: FetchIpfsOptions = {}): Promise<string> => {
  const gateways = opts.gateways ?? DEFAULT_GATEWAYS;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let lastErr: unknown;
  for (const g of gateways) {
    try {
      const res = await fetch(`${g}/${cid}`, {signal: AbortSignal.timeout(timeoutMs)});
      if (!res.ok) {
        lastErr = new Error(`${g}: HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all IPFS gateways failed');
};

/** Convenience: bytes32 → CIDv0 → fetch → parse. Throws on every-gateway failure. */
export const fetchProposalMetadata = async (
  ipfsHash: Hex,
  opts?: FetchIpfsOptions,
): Promise<ProposalMetadata> => {
  const cid = ipfsHashToCidV0(ipfsHash);
  const text = await fetchIpfsText(cid, opts);
  return parseProposalMarkdown(text);
};

/** Like fetchProposalMetadata but never throws — returns undefined on failure. */
export const fetchProposalMetadataSafe = async (
  ipfsHash: Hex,
  opts?: FetchIpfsOptions,
): Promise<ProposalMetadata | undefined> => {
  try {
    return await fetchProposalMetadata(ipfsHash, opts);
  } catch {
    return undefined;
  }
};
