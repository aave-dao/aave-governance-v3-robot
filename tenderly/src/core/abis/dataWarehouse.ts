export const dataWarehouseAbi = [
  {
    name: 'getStorageRoots',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'blockHash', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'processStorageRoot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'blockHash', type: 'bytes32' },
      { name: 'blockHeaderRLP', type: 'bytes' },
      { name: 'accountStateProofRLP', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'processStorageSlot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'blockHash', type: 'bytes32' },
      { name: 'slot', type: 'bytes32' },
      { name: 'storageProof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getRegisteredSlot',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'blockHash', type: 'bytes32' },
      { name: 'account', type: 'address' },
      { name: 'slot', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
