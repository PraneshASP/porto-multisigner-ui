export const accountAbi = [
  // view helpers we need
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getNonce',
    inputs: [{ name: 'seqKey', type: 'uint192' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getKeys',
    inputs: [],
    outputs: [
      { name: 'keys', type: 'tuple[]', components: [{ name: 'keyType', type: 'uint8' }, { name: 'publicKey', type: 'bytes' }] },
      { name: 'keyHashes', type: 'bytes32[]' }
    ],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'computeDigest',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [{ name: 'result', type: 'bytes32' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'unwrapAndValidateSignature',
    inputs: [
      { name: 'digest', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [
      { name: 'isValid', type: 'bool' },
      { name: 'keyHash', type: 'bytes32' },
    ],
  },
  // authorize function for external keys
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'authorize',
    inputs: [{
      name: 'key',
      type: 'tuple',
      components: [
        { name: 'expiry', type: 'uint40' },
        { name: 'keyType', type: 'uint8' },      // 3 = External
        { name: 'isSuperAdmin', type: 'bool' },  // false for External
        { name: 'publicKey', type: 'bytes' },    // abi.encodePacked(multisig, bytes12 salt)
      ],
    }],
    outputs: [{ name: 'keyHash', type: 'bytes32' }],
  },
  // the executor surface we call on submit
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'execute',
    inputs: [
      { name: 'mode', type: 'bytes32' },
      { name: 'executionData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;