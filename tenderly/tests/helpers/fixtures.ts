import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Hex} from 'viem';
import {PayloadState, ProposalState} from '../../src/core/state';

export const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export const baseProposal = {
  state: ProposalState.Created,
  accessLevel: 1,
  creationTime: 1_700_000_000,
  votingDuration: 86_400,
  votingActivationTime: 0,
  queuingTime: 0,
  cancelTimestamp: 0,
  creator: '0x0000000000000000000000000000000000000001',
  votingPortal: GovernanceV3Ethereum.VOTING_PORTAL_ETH_ETH,
  snapshotBlockHash: '0xab',
  ipfsHash: '0xcd',
  forVotes: 0n,
  againstVotes: 0n,
  cancellationFee: 0n,
  payloads: [],
};

export const baseVotingConfig = {
  coolDownBeforeVotingStart: 60 * 60, // 1h
  votingDuration: 86_400,
  yesThreshold: 0n,
  yesNoDifferential: 0n,
  minPropositionPower: 80_000n,
};

export const basePayload = {
  creator: '0x0000000000000000000000000000000000000002',
  maximumAccessLevelRequired: 1,
  state: PayloadState.Queued,
  createdAt: 0,
  queuedAt: 0,
  executedAt: 0,
  cancelledAt: 0,
  expirationTime: 0,
  delay: 86_400,
  gracePeriod: 432_000,
  actions: [],
};

export const baseVoteConfig = {
  votingDuration: 86_400,
  l1ProposalBlockHash: '0x' + 'ab'.repeat(32),
};

/** A 16-field post-merge block header, matching prepareBlockRLP's expected shape. */
export const mockBlock = {
  parentHash: ('0x' + '11'.repeat(32)) as Hex,
  sha3Uncles: ('0x' + '22'.repeat(32)) as Hex,
  miner: ('0x' + '33'.repeat(20)) as Hex,
  stateRoot: ('0x' + '44'.repeat(32)) as Hex,
  transactionsRoot: ('0x' + '55'.repeat(32)) as Hex,
  receiptsRoot: ('0x' + '66'.repeat(32)) as Hex,
  logsBloom: ('0x' + '00'.repeat(256)) as Hex,
  number: '0x10' as Hex,
  gasLimit: '0x1c9c380' as Hex,
  gasUsed: '0x5208' as Hex,
  timestamp: '0x65000000' as Hex,
  extraData: '0x' as Hex,
  mixHash: ('0x' + '77'.repeat(32)) as Hex,
  nonce: '0x0000000000000000' as Hex,
  baseFeePerGas: '0x12a05f200' as Hex,
};

/**
 * Minimal `eth_getProof` response shape. The proof RLP is just stub bytes — proofs.test.ts
 * already exercises the real RLP encoder, and submitStorageRoots tests don't verify proof
 * contents, only that the right entries are built and inspected.
 */
export const buildProofResponse = (
  storageHash: Hex,
  storageProofs: {key: Hex; value: Hex; proof: Hex[]}[] = [],
) => ({
  address: '0x0000000000000000000000000000000000000000',
  accountProof: ['0x80', '0xc0'] as Hex[],
  balance: '0x0',
  codeHash: '0x' + '0'.repeat(64),
  nonce: '0x0',
  storageHash,
  storageProof: storageProofs,
});
