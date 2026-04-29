export const powerStrategyAbi = [
  {
    name: 'getFullPropositionPower',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'user', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
  {
    name: 'getFullVotingPower',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'user', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
] as const;
