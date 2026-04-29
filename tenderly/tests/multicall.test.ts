import {describe, expect, test} from 'bun:test';
import {decodeFunctionData, type Address, type Hex} from 'viem';
import {MULTICALL3_ADDRESS, multicall3Abi} from '../src/core/abis';
import {encodeAggregate3, sendAggregate3, type Call3} from '../src/core/multicall';
import {makeMockWalletClient, makeWalletSpy} from './helpers/mockClient';

const TARGET = ('0x' + '11'.repeat(20)) as Address;

describe('encodeAggregate3', () => {
  test('encodes empty calls round-trip', () => {
    const data = encodeAggregate3([]);
    const decoded = decodeFunctionData({abi: multicall3Abi, data});
    expect(decoded.functionName).toBe('aggregate3');
    expect(decoded.args[0]).toEqual([]);
  });

  test('round-trips a single Call3 entry', () => {
    const calls: Call3[] = [
      {target: TARGET, allowFailure: false, callData: '0xdeadbeef' as Hex},
    ];
    const data = encodeAggregate3(calls);
    const decoded = decodeFunctionData({abi: multicall3Abi, data});
    expect(decoded.functionName).toBe('aggregate3');
    const decodedCalls = decoded.args[0] as ReadonlyArray<Call3>;
    expect(decodedCalls.length).toBe(1);
    expect(decodedCalls[0]?.target.toLowerCase()).toBe(TARGET.toLowerCase());
    expect(decodedCalls[0]?.allowFailure).toBe(false);
    expect(decodedCalls[0]?.callData).toBe('0xdeadbeef');
  });
});

describe('sendAggregate3', () => {
  test('throws when walletClient has no account', async () => {
    const wc = {chain: {id: 1}} as never;
    await expect(sendAggregate3(wc, [])).rejects.toThrow('account');
  });

  test('throws when walletClient has no chain', async () => {
    const wc = {account: {address: '0x' + '00'.repeat(20)}} as never;
    await expect(sendAggregate3(wc, [])).rejects.toThrow('chain');
  });

  test('writes to MULTICALL3_ADDRESS via aggregate3', async () => {
    const spy = makeWalletSpy(('0x' + '7'.repeat(64)) as Hex);
    const wc = makeMockWalletClient(spy, {
      chainId: 1,
      account: ('0x' + '22'.repeat(20)) as Address,
    });
    const calls: Call3[] = [{target: TARGET, allowFailure: false, callData: '0xab' as Hex}];
    const txHash = await sendAggregate3(wc, calls);
    expect(txHash).toBe(spy.txHash);
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]?.address.toLowerCase()).toBe(MULTICALL3_ADDRESS.toLowerCase());
    expect(spy.calls[0]?.functionName).toBe('aggregate3');
    expect(spy.calls[0]?.args[0]).toEqual(calls);
  });
});
