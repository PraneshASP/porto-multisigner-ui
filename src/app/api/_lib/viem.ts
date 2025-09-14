import { createPublicClient, createWalletClient, http, Hex, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
});

const relayer = process.env.RELAYER_PRIVATE_KEY
  ? privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex)
  : undefined;

export const walletClient = relayer
  ? createWalletClient({
      account: relayer,
      chain: baseSepolia,
      transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    })
  : undefined;

export const MODE_SINGLE_WITH_OPDATA: Hex =
  // bytes32 where the "supports opData" bit is set (0x...7821...01) — padded to 32 bytes.
  '0x0100000000007821000100000000000000000000000000000000000000000000';

export const MODE_SINGLE_NO_OPDATA: Hex =
  // bytes32 for single batch without opData support — padded to 32 bytes.
  '0x0100000000000000000000000000000000000000000000000000000000000000';

// handy
export const ensure0x = (h: string) => (h.startsWith('0x') ? (h as Hex) : (`0x${h}` as Hex));