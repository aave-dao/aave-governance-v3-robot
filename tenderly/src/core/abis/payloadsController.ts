export const payloadsControllerAbi = [
  {
    name: 'getPayloadsCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint40' }],
  },
  {
    name: 'getPayloadById',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'payloadId', type: 'uint40' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'maximumAccessLevelRequired', type: 'uint8' },
          { name: 'state', type: 'uint8' },
          { name: 'createdAt', type: 'uint40' },
          { name: 'queuedAt', type: 'uint40' },
          { name: 'executedAt', type: 'uint40' },
          { name: 'cancelledAt', type: 'uint40' },
          { name: 'expirationTime', type: 'uint40' },
          { name: 'delay', type: 'uint40' },
          { name: 'gracePeriod', type: 'uint40' },
          {
            name: 'actions',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              { name: 'withDelegateCall', type: 'bool' },
              { name: 'accessLevel', type: 'uint8' },
              { name: 'value', type: 'uint256' },
              { name: 'signature', type: 'string' },
              { name: 'callData', type: 'bytes' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'executePayload',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'payloadId', type: 'uint40' }],
    outputs: [],
  },
] as const;
