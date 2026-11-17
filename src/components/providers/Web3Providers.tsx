'use client';

import { useContext, useState, type ReactNode } from 'react';
import { createConfig, http, injected, WagmiContext, WagmiProvider } from 'wagmi';
import { avalanche, avalancheFuji } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit/components';
import '@rainbow-me/rainbowkit/styles.css';

// EIP-6963 discovers installed Core and MetaMask providers. No WalletConnect ID,
// relay, fake project identifier, or automatic connection is required.
function Web3ProviderRoot({ children }: { children: ReactNode }) {
  const [config] = useState(() => createConfig({
    chains: [avalancheFuji, avalanche], connectors: [injected()],
    multiInjectedProviderDiscovery: true, ssr: true,
    transports: { [avalancheFuji.id]: http(), [avalanche.id]: http() },
  }));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  return <WagmiProvider config={config} reconnectOnMount={false}><QueryClientProvider client={queryClient}><RainbowKitProvider>{children}</RainbowKitProvider></QueryClientProvider></WagmiProvider>;
}
export function Web3Providers({ children }: { children: ReactNode }) {
  const parentConfig = useContext(WagmiContext);
  // Studio panels share one wallet store. Standalone runtimes still own a root.
  // Separate configs can make wagmi's connection snapshots alternate indefinitely.
  return parentConfig ? children : <Web3ProviderRoot>{children}</Web3ProviderRoot>;
}
export default Web3Providers;
