'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2, Wallet } from 'lucide-react';
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi';
import { Modal } from '@/components/ui/Modal';

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connected wallet';
}

export function WalletEntry({ destination = '/studio', gate = false }: { destination?: string; gate?: boolean }) {
  const { address, chainId, isConnected, status } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [availableConnectors, setAvailableConnectors] = useState<readonly Connector[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(true);
  const [selectedConnector, setSelectedConnector] = useState<string>();
  const connectionInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    // The generic injected connector exists even without a browser provider.
    // Resolve providers rather than presenting unavailable wallet choices.
    Promise.all(connectors.map(async connector => {
      try { return await connector.getProvider() ? connector : undefined; }
      catch { return undefined; }
    })).then(available => {
      if (!active) return;
      setAvailableConnectors(available.filter(connector => connector !== undefined));
      setCheckingProviders(false);
    });
    return () => { active = false; };
  }, [connectors, open]);

  function connectWallet(connector: Connector) {
    if (connectionInFlight.current || isPending) return;
    connectionInFlight.current = true;
    setSelectedConnector(connector.uid);
    connect({ connector }, {
      onSuccess: () => setOpen(false),
      onSettled: () => { connectionInFlight.current = false; },
    });
  }

  if (isConnected) return <div className={`wallet-entry ${gate ? 'wallet-entry-gate' : ''}`}>
    <span className="wallet-entry-address" title={address}><Wallet size={15} /> {shortAddress(address)} · Chain {chainId}</span>
    {!gate && <Link href={destination} className="button button-ink">Open Studio <ArrowUpRight size={16} /></Link>}
    <button type="button" className="wallet-entry-disconnect" onClick={() => disconnect()}>Disconnect</button>
  </div>;

  const waitingForConnection = status === 'reconnecting';
  return <div className={`wallet-entry ${gate ? 'wallet-entry-gate' : ''}`}>
    {waitingForConnection && <span className="wallet-entry-status" role="status"><Loader2 size={14} className="spin" /> Checking wallet connection…</span>}
    {!waitingForConnection && <>
      <Modal open={open} onOpenChange={setOpen} title="Choose a wallet" description="Wallets detected in this browser appear below." trigger={<button type="button" className={gate ? 'button button-primary' : 'button button-ink'}>Connect wallet <ArrowUpRight size={15} /></button>}>
        <div className="wallet-chooser">
          {checkingProviders && <p className="wallet-chooser-help" role="status">Checking for browser wallets…</p>}
          {!checkingProviders && !availableConnectors.length && <p className="wallet-chooser-help">No wallet detected. Use a wallet browser extension or open this page in your wallet’s in-app browser.</p>}
          <ul className="wallet-chooser-list" aria-label="Detected wallets">
            {availableConnectors.map(connector => <li key={connector.uid}><button type="button" className="wallet-chooser-option" disabled={isPending} onClick={() => connectWallet(connector)}>
              <Wallet size={20} aria-hidden="true" /><span>{connector.name}</span>
              {isPending && selectedConnector === connector.uid ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
            </button></li>)}
          </ul>
          {isPending && <p className="wallet-chooser-help" role="status">Connecting to {availableConnectors.find(connector => connector.uid === selectedConnector)?.name ?? 'your wallet'}… Check your wallet to continue.</p>}
          {error && <p className="wallet-entry-error" role="alert">Wallet connection was not completed. Check your wallet and try again.</p>}
        </div>
      </Modal>
      <p className="wallet-entry-help">Connection only — no Impactor account, signature, payment, or upload.</p>
    </>}
  </div>;
}
