import {describe, expect, test} from 'bun:test';
import {getProof, getRawBlockByHash, jsonRpcCall} from '../src/core/rpc';
import {installFetchMock} from './helpers/mockFetch';

const RPC = 'https://rpc.example.com';

describe('jsonRpcCall', () => {
  test('builds a JSON-RPC POST and returns result', async () => {
    let capturedBody: unknown;
    const {restore} = installFetchMock((_url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return {status: 200, body: JSON.stringify({jsonrpc: '2.0', id: 1, result: 'OK'})};
    });
    try {
      const out = await jsonRpcCall<string>(RPC, 'eth_blockNumber', []);
      expect(out).toBe('OK');
      expect(capturedBody).toMatchObject({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      });
    } finally {
      restore();
    }
  });

  test('throws when the body has an error field', async () => {
    const {restore} = installFetchMock(() => ({
      status: 200,
      body: JSON.stringify({jsonrpc: '2.0', id: 1, error: {code: -32000, message: 'bad'}}),
    }));
    try {
      await expect(jsonRpcCall(RPC, 'foo', [])).rejects.toThrow(/bad/);
    } finally {
      restore();
    }
  });

  test('throws on non-2xx HTTP', async () => {
    const {restore} = installFetchMock(() => ({status: 500, body: 'oops'}));
    try {
      await expect(jsonRpcCall(RPC, 'foo', [])).rejects.toThrow();
    } finally {
      restore();
    }
  });
});

describe('getRawBlockByHash', () => {
  test('returns the raw block object verbatim', async () => {
    const block = {number: '0x10', parentHash: '0xab', baseFeePerGas: '0x1'};
    const {restore} = installFetchMock(() => ({
      status: 200,
      body: JSON.stringify({jsonrpc: '2.0', id: 1, result: block}),
    }));
    try {
      const out = await getRawBlockByHash(RPC, '0xabc' as `0x${string}`);
      expect(out).toEqual(block as never);
    } finally {
      restore();
    }
  });
});

describe('getProof', () => {
  test('passes [address, storageKeys, blockNumber] and returns the result', async () => {
    let capturedParams: unknown;
    const proof = {
      address: '0xabc',
      accountProof: ['0xdead'],
      balance: '0x0',
      codeHash: '0x' + '0'.repeat(64),
      nonce: '0x0',
      storageHash: ('0x' + '11'.repeat(32)) as `0x${string}`,
      storageProof: [],
    };
    const {restore} = installFetchMock((_url, init) => {
      capturedParams = JSON.parse(String(init?.body ?? '{}')).params;
      return {status: 200, body: JSON.stringify({jsonrpc: '2.0', id: 1, result: proof})};
    });
    try {
      const out = await getProof(
        RPC,
        '0xa' as `0x${string}`,
        ['0xb' as `0x${string}`],
        '0x10' as `0x${string}`,
      );
      expect(out).toEqual(proof as never);
      expect(capturedParams).toEqual(['0xa', ['0xb'], '0x10']);
    } finally {
      restore();
    }
  });

  test('tolerates empty storageProof', async () => {
    const proof = {
      address: '0xabc',
      accountProof: [],
      balance: '0x0',
      codeHash: '0x' + '0'.repeat(64),
      nonce: '0x0',
      storageHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
      storageProof: [],
    };
    const {restore} = installFetchMock(() => ({
      status: 200,
      body: JSON.stringify({jsonrpc: '2.0', id: 1, result: proof}),
    }));
    try {
      const out = await getProof(RPC, '0xa' as `0x${string}`, [], '0x1' as `0x${string}`);
      expect(out.storageProof).toEqual([]);
    } finally {
      restore();
    }
  });
});
