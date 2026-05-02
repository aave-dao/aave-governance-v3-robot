// IProofOfReserveExecutor — Aave PoR emergency-action executor (V2 + V3 variants).
// Source: reference/contracts/avalanche-proof-of-reserves-keeper/src/interfaces/IProofOfReserveExecutor.sol
//
// The on-chain Chainlink keeper at 0x7aE2930B50CFEbc99FE6DB16CE5B9C7D8d09332C reads
// `areAllReservesBacked()` + `isEmergencyActionPossible()` in checkUpkeep, and calls
// `executeEmergencyAction()` in performUpkeep.
export const proofOfReserveExecutorAbi = [
  {
    name: 'areAllReservesBacked',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{name: '', type: 'bool'}],
  },
  {
    name: 'isEmergencyActionPossible',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{name: '', type: 'bool'}],
  },
  {
    name: 'executeEmergencyAction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;
