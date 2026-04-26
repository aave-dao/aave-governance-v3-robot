import { describe, expect, test } from 'bun:test';
import { fromRlp, type Hex } from 'viem';
import { formatToProofRLP, prepareBlockRLP } from '../src/core/proofs';

describe('prepareBlockRLP', () => {
  test('handles a post-merge / pre-Shanghai block (16 fields)', () => {
    const block = {
      parentHash: '0x' + '11'.repeat(32),
      sha3Uncles: '0x' + '22'.repeat(32),
      miner: '0x' + '33'.repeat(20),
      stateRoot: '0x' + '44'.repeat(32),
      transactionsRoot: '0x' + '55'.repeat(32),
      receiptsRoot: '0x' + '66'.repeat(32),
      logsBloom: '0x' + '00'.repeat(256),
      number: '0x10',
      gasLimit: '0x1c9c380',
      gasUsed: '0x5208',
      timestamp: '0x65000000',
      extraData: '0x',
      mixHash: '0x' + '77'.repeat(32),
      nonce: '0x0000000000000000',
      baseFeePerGas: '0x12a05f200',
    };
    const rlp = prepareBlockRLP(block);
    expect(rlp).toMatch(/^0x[0-9a-f]+$/);
    const decoded = fromRlp(rlp, 'hex');
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded.length).toBe(16);
  });

  test('handles a Pectra block (21 fields)', () => {
    const block = {
      parentHash: '0x' + '11'.repeat(32),
      sha3Uncles: '0x' + '22'.repeat(32),
      miner: '0x' + '33'.repeat(20),
      stateRoot: '0x' + '44'.repeat(32),
      transactionsRoot: '0x' + '55'.repeat(32),
      receiptsRoot: '0x' + '66'.repeat(32),
      logsBloom: '0x' + '00'.repeat(256),
      number: '0x10',
      gasLimit: '0x1c9c380',
      gasUsed: '0x5208',
      timestamp: '0x65000000',
      extraData: '0x',
      mixHash: '0x' + '77'.repeat(32),
      nonce: '0x0000000000000000',
      baseFeePerGas: '0x12a05f200',
      withdrawalsRoot: '0x' + '88'.repeat(32),
      blobGasUsed: '0x0',
      excessBlobGas: '0x0',
      parentBeaconBlockRoot: '0x' + '99'.repeat(32),
      requestsHash: '0x' + 'aa'.repeat(32),
    };
    const decoded = fromRlp(prepareBlockRLP(block), 'hex');
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded.length).toBe(21);
  });
});

describe('formatToProofRLP', () => {
  test('round-trips a list of RLP-encoded nodes', () => {
    const nodes: Hex[] = ['0x80', '0xc0', '0x82' + 'aabb'] as Hex[];
    const out = formatToProofRLP(nodes);
    const decoded = fromRlp(out, 'hex');
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded.length).toBe(3);
  });
});
