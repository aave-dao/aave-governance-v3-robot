export const votingStrategyAbi = [
  {
    name: 'hasRequiredRoots',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'blockHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'STK_AAVE_SLASHING_EXCHANGE_RATE_SLOT',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'DATA_WAREHOUSE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
