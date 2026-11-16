'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

export function WalletControls() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  return <div className="rt-wallet">
    {isConnected ? <>
      <span className="rt-address" title={address}>{address?.slice(0, 6)}…{address?.slice(-4)} · Chain {chainId}</span>
      {chainId !== 43113 && <button type="button" disabled={switching} onClick={() => switchChain({ chainId: 43113 })}>Switch to Fuji</button>}
      <button type="button" onClick={() => disconnect()}>Disconnect</button>
    </> : <>
      {connectors.map(connector => <button type="button" key={connector.uid} disabled={isPending} onClick={() => connect({ connector })}>{isPending ? 'Connecting…' : `Connect ${connector.name}`}</button>)}
      {!connectors.length && <span>Install Core or MetaMask to connect. Editing does not need a wallet.</span>}
    </>}
    {(error || switchError) && <span role="alert">Wallet connection or network switch was not completed. Check your wallet and try again.</span>}
  </div>;
}
