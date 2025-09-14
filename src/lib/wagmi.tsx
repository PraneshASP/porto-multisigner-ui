'use client';
import { createConfig, http, WagmiProvider,createStorage } from 'wagmi';
import { baseSepolia } from './chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { injected, walletConnect } from '@wagmi/connectors';
import { porto } from 'porto/wagmi'

const queryClient = new QueryClient();

// TEMP wallet: public client only (Phase 1 writes will use "account = msg.sender" as the EOA you connect with).
// In Phase 2 we replace with Porto connector + Account.
export const config = createConfig({
  chains: [baseSepolia],
  connectors: [porto()],
  storage: createStorage({ storage: typeof window !== 'undefined' ? localStorage : undefined }),
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  },
   ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}