import { Hex, encodeAbiParameters, encodeFunctionData } from 'viem';
import { MODE_SINGLE_NO_OPDATA, MODE_SINGLE_WITH_OPDATA } from '@/app/api/_lib/viem';

export const EMPTY_CALLDATA_FN_SEL = '0xe0e0e0e0' as Hex;
export const ANY_TARGET = '0x3232323232323232323232323232323232323232' as Hex; // 0x32 repeated (see GuardedExecutor)

// Encodes execute(mode, abi.encode(calls)) where calls[0] = this.setCanExecute(keyHash, target, fnSel, can)
export function encodeSetCanExecuteExecute({
  account,
  keyHash,
  target,
  fnSel,
  can,
  accountAbi,
}: {
  account: Hex;
  keyHash: Hex;
  target: Hex;
  fnSel: Hex; // bytes4
  can: boolean;
  accountAbi: any;
}): { to: Hex; data: Hex } {
  // calldata for setCanExecute(bytes32,address,bytes4,bool)
  const setData = encodeFunctionData({
    abi: accountAbi,
    functionName: 'setCanExecute',
    args: [keyHash, target, fnSel, can],
  });

  // Calls[]: a single self-call; using to=0x0 means "address(this)"
  const callsEncoded = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [[{ to: '0x0000000000000000000000000000000000000000', value: 0n, data: setData }]],
  );

  const data = encodeFunctionData({
    abi: accountAbi,
    functionName: 'execute',
    args: [MODE_SINGLE_NO_OPDATA, callsEncoded],
  });

  return { to: account, data };
}

// Encodes execute(mode, abi.encode(calls)) where calls[0] = this.setSpendLimit(keyHash, token, period, limit)
export function encodeSetSpendLimitExecute({
  account,
  keyHash,
  token,
  period,
  limit,
  accountAbi,
}: {
  account: Hex;
  keyHash: Hex;
  token: Hex; // address(0) for native
  period: number; // 0..6 (Minute..Forever)
  limit: bigint;
  accountAbi: any;
}): { to: Hex; data: Hex } {
  const setData = encodeFunctionData({
    abi: accountAbi,
    functionName: 'setSpendLimit',
    args: [keyHash, token, period, limit],
  });

  const callsEncoded = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [[{ to: '0x0000000000000000000000000000000000000000', value: 0n, data: setData }]],
  );

  const data = encodeFunctionData({
    abi: accountAbi,
    functionName: 'execute',
    args: [MODE_SINGLE_NO_OPDATA, callsEncoded],
  });

  return { to: account, data };
}
