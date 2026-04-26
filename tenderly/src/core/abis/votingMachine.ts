export const votingMachineAbi = [
  {
    name: 'getProposalState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'proposalId', type: 'uint256'}],
    outputs: [{name: '', type: 'uint8'}],
  },
  {
    name: 'getProposalById',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'proposalId', type: 'uint256'}],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          {name: 'id', type: 'uint256'},
          {name: 'sentToGovernance', type: 'bool'},
          {name: 'startTime', type: 'uint40'},
          {name: 'endTime', type: 'uint40'},
          {name: 'votingClosedAndSentTimestamp', type: 'uint40'},
          {name: 'forVotes', type: 'uint128'},
          {name: 'againstVotes', type: 'uint128'},
          {name: 'creationBlockNumber', type: 'uint256'},
          {name: 'votingClosedAndSentBlockNumber', type: 'uint256'},
        ],
      },
    ],
  },
  {
    name: 'getProposalVoteConfiguration',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'proposalId', type: 'uint256'}],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          {name: 'votingDuration', type: 'uint24'},
          {name: 'l1ProposalBlockHash', type: 'bytes32'},
        ],
      },
    ],
  },
  {
    name: 'getProposalsVoteConfigurationIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {name: 'skip', type: 'uint256'},
      {name: 'size', type: 'uint256'},
    ],
    outputs: [{name: '', type: 'uint256[]'}],
  },
  {
    name: 'startProposalVote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{name: 'proposalId', type: 'uint256'}],
    outputs: [{name: '', type: 'uint256'}],
  },
  {
    name: 'closeAndSendVote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{name: 'proposalId', type: 'uint256'}],
    outputs: [],
  },
  {
    name: 'DATA_WAREHOUSE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{name: '', type: 'address'}],
  },
  {
    name: 'VOTING_STRATEGY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{name: '', type: 'address'}],
  },
] as const;
