import {describe, expect, test} from 'bun:test';
import {DISABLED_PAYLOADS, isPayloadDisabled} from '../src/core/disabledPayloads';

describe('isPayloadDisabled', () => {
  test('matches a known disabled entry by bigint id', () => {
    const entry = DISABLED_PAYLOADS[0];
    if (!entry) throw new Error('DISABLED_PAYLOADS unexpectedly empty');
    const result = isPayloadDisabled(entry.chainId, BigInt(entry.payloadId));
    expect(result).toBeDefined();
    expect(result?.reason).toBe(entry.reason);
  });

  test('matches a known disabled entry by number id', () => {
    const entry = DISABLED_PAYLOADS[0];
    if (!entry) throw new Error('DISABLED_PAYLOADS unexpectedly empty');
    const result = isPayloadDisabled(entry.chainId, entry.payloadId);
    expect(result).toBeDefined();
  });

  test('returns undefined for an unrelated chainId', () => {
    const entry = DISABLED_PAYLOADS[0];
    if (!entry) throw new Error('DISABLED_PAYLOADS unexpectedly empty');
    expect(isPayloadDisabled(99999, entry.payloadId)).toBeUndefined();
  });

  test('returns undefined for an unrelated payloadId on a known chain', () => {
    const entry = DISABLED_PAYLOADS[0];
    if (!entry) throw new Error('DISABLED_PAYLOADS unexpectedly empty');
    expect(isPayloadDisabled(entry.chainId, entry.payloadId + 100)).toBeUndefined();
  });
});
