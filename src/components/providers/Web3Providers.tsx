'use client';

import { useState, type ReactNode } from 'react';
import { createConfig, http, injected, WagmiProvider } from 'wagmi';
import { avalanche, avalancheFuji } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit/components';
import '@rainbow-me/rainbowkit/styles.css';

// EIP-6963 discovers installed Core and MetaMask providers. No WalletConnect ID,
// relay, fake project identifier, or automatic connection is required.
export function Web3Providers({ children }: { children: ReactNode }) {
  const [config] = useState(() => createConfig({
    chains: [avalancheFuji, avalanche], connectors: [injected()],
    multiInjectedProviderDiscovery: true, ssr: true,
    transports: { [avalancheFuji.id]: http(), [avalanche.id]: http() },
  }));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  return <WagmiProvider config={config} reconnectOnMount={false}><QueryClientProvider client={queryClient}><RainbowKitProvider>{children}</RainbowKitProvider></QueryClientProvider></WagmiProvider>;
}
export default Web3Providers;
