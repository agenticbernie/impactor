'use client';
import { useRef, useState } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { getAccount, getWalletClient } from 'wagmi/actions';
import { formatEther } from 'viem';
import type { ImpactorProjectSchema } from '@/lib/schema/types';
import { Modal } from '@/components/ui/Modal';
import { WalletControls } from '@/components/runtime/WalletControls';
import { Publisher, type PublishState } from '@/lib/irys/publisher';
import { readPublications, websiteUrl } from '@/lib/irys/journal';
import { snapshotText } from '@/lib/irys/site';
import { verifyWebsite } from '@/lib/irys/verify';
import type { PublishRecord } from '@/lib/irys/types';

export function PublishDialog({ project, open, onOpenChange }: { project: ImpactorProjectSchema; open: boolean; onOpenChange: (open: boolean) => void }) {
  const config = useConfig(); const account = useAccount();
  const latest = useRef(project); latest.current = project;
  const [state, setState] = useState<PublishState>({ busy: false, progress: '' });
  const publisher = useRef<Publisher | null>(null);
  if (!publisher.current) publisher.current = new Publisher(() => latest.current, setState, undefined, () => getAccount(config));
  const [acknowledged, setAcknowledged] = useState(false);
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const [recoveryHash, setRecoveryHash] = useState('');
  const [error, setError] = useState('');
  const run = async (task: () => Promise<void>) => { setError(''); try { await task(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Wallet unavailable.'); } };
  const q = state.quote;
  let snapshot = ''; try { snapshot = snapshotText(project); } catch { /* Invalid projects cannot be prepared. */ }
  const stale = !!q && (q.snapshot !== snapshot || q.address.toLowerCase() !== account.address?.toLowerCase() || account.chainId !== 43113);
  const eligible = !!snapshot && account.isConnected && account.chainId === 43113 && acknowledged && !state.busy;
  const deficit = q && q.price > q.balance ? q.price - q.balance : 0n;
  const unresolvedFunding = state.funding && state.funding.status !== 'credited';
  const result = state.result;
  return <Modal open={open} onOpenChange={onOpenChange} title="Publish a Fuji website" description="Experimental Irys devnet hosting · a self-contained static app, not an Impactor preview link." wide>
    <div className="field-stack">
      {result && <button className="button button-secondary" disabled={state.busy} onClick={() => publisher.current!.startNew()}>Prepare a different snapshot (keep recovery history)</button>}
      <div className="validation-summary"><strong>Public data. Temporary testnet storage.</strong><p>Everything in the project—including initial values, contract configuration and RPC URLs—becomes public. Remove secrets and private credentials. Irys devnet data is typically retained for about 60 days, not permanently. Core/MetaMask signing and live gateway delivery still need real-wallet acceptance testing.</p><p>Only Fuji test AVAX (chain 43113) is supported. Storage credit is separate from wallet gas. No mainnet funding, automatic top-ups or wallet actions happen when opening this dialog.</p></div>
      <WalletControls />
      <label><input type="checkbox" checked={acknowledged} disabled={state.busy} onChange={e => setAcknowledged(e.target.checked)} /> I reviewed the public project data and understand temporary, experimental hosting.</label>
      {!snapshot && <p role="alert">Resolve project validation errors and select Avalanche Fuji before publishing.</p>}
      <div className="project-actions"><button className="button button-secondary" disabled={!eligible || !!result?.bundleId} onClick={() => void run(async () => publisher.current!.prepare(await getWalletClient(config)))}>Prepare snapshot & quote (no signature)</button><button className="button button-secondary" disabled={state.busy} onClick={() => setHistory(readPublications())}>Load local publication history</button></div>
      {q && <section aria-label="Publish quote"><h3>Review storage quote</h3><dl className="shortcut-list"><div><dt>Network / asset</dt><dd>Fuji 43113 / test AVAX · Irys devnet</dd></div><div><dt>Website / signed bundle</dt><dd>{q.site.bytes.toLocaleString()} / {q.prepared.bytes.toLocaleString()} bytes</dd></div><div><dt>Storage price (includes manifest and bundle overhead)</dt><dd>{formatEther(q.price)} AVAX</dd></div><div><dt>Existing Irys storage balance</dt><dd>{formatEther(q.balance)} AVAX</dd></div><div><dt>Additional funding</dt><dd>{formatEther(deficit)} AVAX + wallet gas</dd></div></dl><p className="muted-help">Quote expires at {new Date(q.expires).toLocaleTimeString()}. Price, balance, wallet and project are checked again before acting. This fresh exact bundle quote may differ from an earlier credited storage balance; nothing is funded automatically. Gas is estimated by your wallet, not included in storage price.</p><p className="muted-help">Funding recipient: <code className="rt-address">{q.target}</code></p>{stale && <p role="alert">Project or wallet changed. This quote is no longer usable.</p>}
        <div className="project-actions"><button className="button button-secondary" disabled={!eligible || stale || deficit === 0n || !!unresolvedFunding || !!result?.bundleId} onClick={() => void publisher.current!.fund()}>1. Fund {formatEther(deficit)} test AVAX + gas</button><button className="button button-primary" disabled={!eligible || stale || deficit > 0n || !!result?.bundleId} onClick={() => void publisher.current!.upload()}>2. Sign & upload public website</button></div><p className="muted-help">Funding is a wallet transfer. The separate upload typed-data signature authorizes spending storage credit for this exact website bundle. Reject either prompt to stop. No token allowance is requested.</p>
      </section>}
      {state.funding && <section><h3>Funding recovery · {state.funding.status}</h3><p>Closing this dialog does not cancel a broadcast. Never repeat a payment just because credit is delayed.</p>{state.funding.hash ? <code className="rt-address">{state.funding.hash}</code> : <label className="field-label">Original Fuji transaction hash (from wallet history)<input value={recoveryHash} onChange={e => setRecoveryHash(e.target.value)} placeholder="0x…" /></label>}<button className="button button-secondary" disabled={state.busy || !account.isConnected || account.chainId !== 43113} onClick={() => void run(async () => publisher.current!.recoverFunding(await getWalletClient(config), recoveryHash))}>Check existing funding credit (no payment)</button></section>}
      {(error || state.error) && <p className="rt-error" role="alert">{error || state.error}</p>}
      {state.progress && <p role="status" aria-live="polite">{state.busy ? 'In progress: ' : ''}{state.progress}</p>}
      {result?.bundleId && <section className="capability-card"><h3>{result.verified ? 'Website content verified' : result.uploaded ? 'Upload accepted · verification pending' : 'Upload outcome uncertain · retained ID'}</h3><p>Manifest ID: <code className="rt-address">{result.manifestId}</code></p><p>Bundle ID: <code className="rt-address">{result.bundleId}</code></p><a className="text-link" href={websiteUrl(result.manifestId)} target="_blank" rel="noopener noreferrer">Open public gateway website</a><p>Until verification passes, indexing, redirects, CORS or gateway delivery may still be unavailable. This link is retained even if verification fails. Content verification is not a security audit or a guarantee of future availability.</p><button className="button button-secondary" disabled={state.busy} onClick={() => void publisher.current!.verify(verifyWebsite)}>Verify gateway content (no payment or upload)</button></section>}
      {history.length > 0 && <section><h3>Local recovery records</h3><p>Public hashes and IDs only; browser storage can be cleared. Save IDs somewhere safe.</p>{history.map(record => <div key={record.manifestId}><code className="rt-address">{record.manifestId}</code><button className="button button-secondary" disabled={state.busy} onClick={() => publisher.current!.restore(record)}>Recover {record.verified ? 'verified' : 'pending'} publication</button></div>)}</section>}
      <p className="muted-help">You may close and reopen this dialog without cancelling pending work. Do not close the browser during wallet prompts. Once submitted, public uploads and payments cannot be undone.</p>
    </div>
  </Modal>;
}
