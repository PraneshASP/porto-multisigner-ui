import { Hex, concatHex, encodeAbiParameters, keccak256, toHex, encodeFunctionData } from 'viem';

export const MODE_SINGLE_NO_OPDATA =
  '0x0100000000000000000000000000000000000000000000000000000000000000' as const;

// Build External key material
export function externalPublicKey(multisig: Hex, salt12: Hex): Hex {
  // salt must be 12 bytes (24 hex chars after 0x). Example: 0x000000000000000000000000
  return concatHex([multisig, salt12]); // 20 + 12 = 32 bytes
}

// Compute bytes32 keyHash for External keyType (=3)
export function computeExternalKeyHash(multisig: Hex, salt12: Hex): Hex {
  const pub = externalPublicKey(multisig, salt12);
  const pubHash = keccak256(pub);
  const packed = encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [3, pubHash]);
  return keccak256(packed);
}

// Encode `execute(mode, abi.encode(calls))` where calls[0] = this.authorize(Key)
export function encodeAuthorizeExternalExecute({
  account,
  multisig,
  salt12,
  accountAbi,
}: { account: Hex; multisig: Hex; salt12: Hex; accountAbi: any }): { to: Hex; data: Hex; externalKeyHash: Hex } {
  const publicKey = externalPublicKey(multisig, salt12);
  const key = { expiry: 0, keyType: 3, isSuperAdmin: false, publicKey };

  // calldata for authorize(Key)
  const authorizeData = encodeFunctionData({
    abi: accountAbi,
    functionName: 'authorize',
    args: [key],
  });

  // Calls[]: a single self-call; using to=0x0 means "address(this)"
  const callsEncoded = encodeAbiParameters(
    [{ type: 'tuple[]', components: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ]}],
    [[{ to: '0x0000000000000000000000000000000000000000', value: 0n, data: authorizeData }]],
  );

  const data = encodeFunctionData({
    abi: accountAbi,
    functionName: 'execute',
    args: [MODE_SINGLE_NO_OPDATA, callsEncoded],
  });

  const externalKeyHash = computeExternalKeyHash(multisig, salt12);
  return { to: account, data, externalKeyHash };
}