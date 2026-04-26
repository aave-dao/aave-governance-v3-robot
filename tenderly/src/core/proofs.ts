import { fromRlp, toRlp, type Hex } from 'viem';

/**
 * Normalize a hex quantity for RLP encoding.
 * RLP represents zero as empty bytes '0x', not '0x0' or '0x00'.
 * Also strips leading zeros from hex quantities so they're canonical.
 *
 * Ported from cre/gov-storage-roots/proofs.ts.
 */
const normalizeQuantity = (hex: string): Hex => {
  if (!hex || hex === '0x' || hex === '0x0' || hex === '0x00') return '0x';
  const stripped = hex.replace(/^0x0+/, '0x');
  return (stripped === '0x' ? '0x' : stripped) as Hex;
};

/** Raw block as returned by `eth_getBlockByHash(hash, false)` (uncle/tx hashes only). */
export type RawBlock = Record<string, string>;

/**
 * Encode the block header to RLP. Supports headers up to Pectra (21 fields).
 * Source of truth for field ordering: go-ethereum's `core/types/block.go` Header struct.
 */
export const prepareBlockRLP = (rawBlock: RawBlock): Hex => {
  const fields: Hex[] = [
    rawBlock.parentHash as Hex,
    rawBlock.sha3Uncles as Hex,
    rawBlock.miner as Hex,
    rawBlock.stateRoot as Hex,
    rawBlock.transactionsRoot as Hex,
    rawBlock.receiptsRoot as Hex,
    rawBlock.logsBloom as Hex,
    '0x', // difficulty is 0 post-merge
    normalizeQuantity(rawBlock.number!),
    normalizeQuantity(rawBlock.gasLimit!),
    normalizeQuantity(rawBlock.gasUsed!),
    normalizeQuantity(rawBlock.timestamp!),
    rawBlock.extraData as Hex,
    rawBlock.mixHash as Hex,
    rawBlock.nonce as Hex,
  ];

  if (rawBlock.baseFeePerGas) fields.push(normalizeQuantity(rawBlock.baseFeePerGas));
  if (rawBlock.withdrawalsRoot) fields.push(rawBlock.withdrawalsRoot as Hex);
  if (rawBlock.blobGasUsed !== undefined) {
    fields.push(normalizeQuantity(rawBlock.blobGasUsed));
    fields.push(normalizeQuantity(rawBlock.excessBlobGas!));
  }
  if (rawBlock.parentBeaconBlockRoot) fields.push(rawBlock.parentBeaconBlockRoot as Hex);
  if (rawBlock.requestsHash) fields.push(rawBlock.requestsHash as Hex);

  return toRlp(fields);
};

/**
 * Re-encode an array of individually RLP-encoded proof nodes into a single RLP-encoded value.
 * Each element of `rawData` is an RLP-encoded node from `eth_getProof`; we decode each and
 * re-encode the entire array as one RLP — this is the format DataWarehouse expects.
 */
export const formatToProofRLP = (rawData: Hex[]): Hex =>
  toRlp(rawData.map((d) => fromRlp(d, 'hex')));
