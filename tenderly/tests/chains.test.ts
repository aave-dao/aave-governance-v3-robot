import {describe, expect, test} from 'bun:test';
import type {Address} from 'viem';
import {VOTING_CHAINS, findVotingChainByPortal} from '../src/core/chains';

describe('findVotingChainByPortal', () => {
  test('finds each configured voting chain by its portal', () => {
    for (const config of Object.values(VOTING_CHAINS)) {
      const found = findVotingChainByPortal(config.votingPortal);
      expect(found).toBeDefined();
      expect(found?.chainId).toBe(config.chainId);
    }
  });

  test('lookup is case-insensitive', () => {
    const eth = VOTING_CHAINS[1];
    if (!eth) throw new Error('eth voting config missing');
    const upper = (eth.votingPortal.toUpperCase().replace('0X', '0x')) as Address;
    expect(findVotingChainByPortal(upper)?.chainId).toBe(1);

    const lower = eth.votingPortal.toLowerCase() as Address;
    expect(findVotingChainByPortal(lower)?.chainId).toBe(1);
  });

  test('returns undefined for an unknown portal', () => {
    expect(
      findVotingChainByPortal(('0x' + 'ff'.repeat(20)) as Address),
    ).toBeUndefined();
  });
});
