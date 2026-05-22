// Single source of truth for the proposal-lifecycle event ABIs we listen to in tenderly.
// Mirrors what `interface/lib/lifecycle-index.ts` already parses, plus `ProposalCreated`
// (which the index file doesn't need since it can derive ipfsHash from `getProposal`).
//
// Each entry carries:
//   - `abi`        parseAbiItem-form for viem decoding
//   - `topic`      keccak topic0 hash, for fast log filtering
//   - `proposalIdArg`  the key under decoded.args that holds the proposalId (all our
//                       events use `proposalId` as the first indexed arg, but we keep
//                       this explicit so future events with different naming can be added)

import {parseAbiItem, toEventSelector, type AbiEvent, type Hex} from 'viem';

export type LifecycleEventName =
  | 'ProposalCreated'
  | 'VotingActivated'
  | 'ProposalQueued'
  | 'ProposalExecuted'
  | 'ProposalCanceled'
  | 'ProposalVoteConfigurationBridged'
  | 'ProposalVoteStarted'
  | 'ProposalResultsSent';

export type LifecycleEventInfo = {
  name: LifecycleEventName;
  abi: AbiEvent;
  topic: Hex;
  /** Where this event lives — L1 governance or per-chain voting machine. */
  layer: 'l1' | 'vm';
  /** Whether the action that emits this is one we (the robot) typically sign. */
  ownerCallable: boolean;
};

const item = (sig: string): AbiEvent => parseAbiItem(sig) as AbiEvent;

export const LIFECYCLE_EVENTS: Record<LifecycleEventName, LifecycleEventInfo> = {
  // L1 governance — GovernanceCore at GovernanceV3Ethereum.GOVERNANCE
  ProposalCreated: {
    name: 'ProposalCreated',
    abi: item(
      'event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint8 indexed accessLevel, bytes32 ipfsHash)',
    ),
    topic: toEventSelector(
      'ProposalCreated(uint256 indexed proposalId, address indexed creator, uint8 indexed accessLevel, bytes32 ipfsHash)',
    ),
    layer: 'l1',
    ownerCallable: false, // emitted by proposer, never our robot
  },
  VotingActivated: {
    name: 'VotingActivated',
    abi: item(
      'event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
    ),
    topic: toEventSelector(
      'VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
    ),
    layer: 'l1',
    ownerCallable: true,
  },
  ProposalQueued: {
    name: 'ProposalQueued',
    abi: item(
      'event ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
    ),
    topic: toEventSelector(
      'ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
    ),
    layer: 'l1',
    // queueProposal is called by the cross-chain receiver (ADI), not our robot.
    ownerCallable: false,
  },
  ProposalExecuted: {
    name: 'ProposalExecuted',
    abi: item('event ProposalExecuted(uint256 indexed proposalId)'),
    topic: toEventSelector('ProposalExecuted(uint256 indexed proposalId)'),
    layer: 'l1',
    ownerCallable: true,
  },
  ProposalCanceled: {
    name: 'ProposalCanceled',
    abi: item('event ProposalCanceled(uint256 indexed proposalId)'),
    topic: toEventSelector('ProposalCanceled(uint256 indexed proposalId)'),
    layer: 'l1',
    ownerCallable: true,
  },

  // L2 voting machine
  ProposalVoteConfigurationBridged: {
    name: 'ProposalVoteConfigurationBridged',
    abi: item(
      'event ProposalVoteConfigurationBridged(uint256 indexed proposalId, bytes32 indexed blockHash, uint24 votingDuration, bool indexed voteCreated)',
    ),
    topic: toEventSelector(
      'ProposalVoteConfigurationBridged(uint256 indexed proposalId, bytes32 indexed blockHash, uint24 votingDuration, bool indexed voteCreated)',
    ),
    layer: 'vm',
    // Emitted by the ADI receiver on L2 — never our robot.
    ownerCallable: false,
  },
  ProposalVoteStarted: {
    name: 'ProposalVoteStarted',
    abi: item(
      'event ProposalVoteStarted(uint256 indexed proposalId, bytes32 indexed l1BlockHash, uint256 startTime, uint256 endTime)',
    ),
    topic: toEventSelector(
      'ProposalVoteStarted(uint256 indexed proposalId, bytes32 indexed l1BlockHash, uint256 startTime, uint256 endTime)',
    ),
    layer: 'vm',
    ownerCallable: true,
  },
  ProposalResultsSent: {
    name: 'ProposalResultsSent',
    abi: item(
      'event ProposalResultsSent(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes)',
    ),
    topic: toEventSelector(
      'ProposalResultsSent(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes)',
    ),
    layer: 'vm',
    ownerCallable: true,
  },
};

/** Reverse lookup: topic0 → event info. Used by the listeners to dispatch by log topic. */
export const LIFECYCLE_EVENT_BY_TOPIC: Record<string, LifecycleEventInfo> = Object.fromEntries(
  Object.values(LIFECYCLE_EVENTS).map((e) => [e.topic.toLowerCase(), e]),
);

/** Events on the L1 governance contract — used to size the listener's filter array. */
export const L1_LIFECYCLE_EVENTS: LifecycleEventName[] = [
  'ProposalCreated',
  'VotingActivated',
  'ProposalQueued',
  'ProposalExecuted',
  'ProposalCanceled',
];

/** Events on the voting machine — same set per voting chain. */
export const VM_LIFECYCLE_EVENTS: LifecycleEventName[] = [
  'ProposalVoteConfigurationBridged',
  'ProposalVoteStarted',
  'ProposalResultsSent',
];

/** Events whose emitting tx sends an ADI cross-chain envelope (for deep-link enrichment). */
export const ENVELOPE_EMITTING_EVENTS = new Set<LifecycleEventName>([
  'ProposalExecuted',
  'ProposalResultsSent',
]);
