import { createPublicClient, defineChain, http } from 'viem';
import type { AvalancheNetworkConfig } from '../schema/types';

export const FUJI_CHAIN_ID = 43113;
export function chainFor(network: AvalancheNetworkConfig) {
  const url = new URL(network.rpcUrl);
  if (url.protocol !== 'https:') throw new Error('Public RPC configuration requires HTTPS');
  if (url.username || url.password) throw new Error('RPC URLs cannot contain credentials');
  return defineChain({ id: network.chainId, name: network.name, nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: [network.rpcUrl] } },
    ...(network.explorerUrl ? { blockExplorers: { default: { name: 'Explorer', url: network.explorerUrl } } } : {}),
  });
}
export function publicClientFor(network: AvalancheNetworkConfig) {
  return createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}
export function assertFuji(network: AvalancheNetworkConfig): void {
  if (network.chainId !== FUJI_CHAIN_ID) throw new Error('Writes and deployments are supported only on Avalanche Fuji (43113). No Mainnet spending.');
}
