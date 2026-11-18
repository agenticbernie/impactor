'use client';

import Link from 'next/link';
import { ArrowUpRight, Loader2, Wallet } from 'lucide-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connected wallet';
}

export function WalletEntry({ destination = '/studio', gate = false }: { destination?: string; gate?: boolean }) {
  const { address, chainId, isConnected, status } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) return <div className={`wallet-entry ${gate ? 'wallet-entry-gate' : ''}`}>
    <span className="wallet-entry-address" title={address}><Wallet size={15} /> {shortAddress(address)} · Chain {chainId}</span>
    {!gate && <Link href={destination} className="button button-ink">Open Studio <ArrowUpRight size={16} /></Link>}
    <button type="button" className="wallet-entry-disconnect" onClick={() => disconnect()}>Disconnect</button>
  </div>;

  const waitingForConnection = status === 'reconnecting';
  return <div className={`wallet-entry ${gate ? 'wallet-entry-gate' : ''}`}>
    {waitingForConnection && <span className="wallet-entry-status" role="status"><Loader2 size={14} className="spin" /> Checking wallet connection…</span>}
    {!waitingForConnection && connectors.map(connector => <button type="button" key={connector.uid} className={gate ? 'button button-primary' : 'button button-ink'} disabled={isPending} onClick={() => connect({ connector })}>
      {isPending ? <><Loader2 size={15} className="spin" /> Connecting…</> : <>Connect {connector.name} · sign in / sign up <ArrowUpRight size={15} /></>}
    </button>)}
    {!waitingForConnection && <p className="wallet-entry-help">Connection only — no Impactor account, signature, payment, or upload.</p>}
    {!waitingForConnection && !connectors.length && <p className="wallet-entry-help">Install Core or MetaMask to connect a wallet.</p>}
    {error && <p className="wallet-entry-error" role="alert">Wallet connection was not completed. Check your wallet and try again.</p>}
  </div>;
}
