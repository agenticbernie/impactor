'use client';

import { useEffect, useRef, useState } from 'react';
import { useConfig } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import type { ImpactorProjectSchema, ContractConfig } from '../../lib/schema/types';
import { getFunctions, parseAbiJson, registerContract } from '../../lib/web3/contracts';
import { CONTRACT_TEMPLATES, TEMPLATE_MANIFESTS, deployTemplate, type DeploymentInput } from '../../lib/web3/templates';
import { checkReceipt, readJournal } from '../../lib/web3/transactions';
import { ActionError, type StepStatus } from '../../lib/engine/workflow';
import { Web3Providers } from '../providers/Web3Providers';
import { WalletControls } from './WalletControls';
import { TransactionReviewDialog, useTransactionReview } from './TransactionReview';
import './runtime.css';

type Props = { project: ImpactorProjectSchema; onChange: (project: ImpactorProjectSchema) => void; locked?: boolean };
function ContractManagerBody({ project, onChange, locked = false }: Props) {
  const config = useConfig();
  const latest = useRef({ project, onChange }); latest.current = { project, onChange };
  const [tab, setTab] = useState<'import' | 'deploy'>('import');
  const [address, setAddress] = useState(''); const [name, setName] = useState(''); const [abiText, setAbiText] = useState('');
  const [functions, setFunctions] = useState<ReturnType<typeof getFunctions>>([]); const [exposed, setExposed] = useState<string[]>([]);
  const [form, setForm] = useState<DeploymentInput>({ templateId: 'erc20-fixed-v1', name: '', symbol: '', owner: '', supply: '1000000' });
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [status, setStatus] = useState<StepStatus>('idle'); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [hash, setHash] = useState<`0x${string}`>();
  const pending = useRef<{ project: ImpactorProjectSchema; form: DeploymentInput } | undefined>(undefined);
  const { intent, review, answer } = useTransactionReview();
  useEffect(() => { if (locked && intent) answer(false); }, [answer, intent, locked]);
  const template = CONTRACT_TEMPLATES.find(item => item.templateId === form.templateId)!;
  function add(contract: ContractConfig, original: ImpactorProjectSchema) {
    if (latest.current.project.id !== original.id || latest.current.project.network.chainId !== original.network.chainId) {
      setMessage(`Contract confirmed at ${contract.address} on chain ${contract.chainId}. The editor project changed; import this address manually into the original project.`); return;
    }
    const current = latest.current.project;
    if (current.contracts.some(item => item.chainId === contract.chainId && item.address.toLowerCase() === contract.address.toLowerCase())) throw new Error('This contract address is already registered');
    latest.current.onChange({ ...current, contracts: [...current.contracts, contract] });
    setMessage(`Registered ${contract.name} at ${contract.address}. Code presence is not source verification or an audit.`);
  }
  function inspectAbi() {
    try { const descriptors = getFunctions(parseAbiJson(abiText)); setFunctions(descriptors); setExposed(descriptors.filter(fn => fn.supported).map(fn => fn.signature)); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid ABI'); setFunctions([]); setExposed([]); }
  }
  async function importContract(event: React.FormEvent) {
    event.preventDefault(); if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setMessage('');
    const snapshot = structuredClone(project);
    try { const contract = await registerContract(snapshot.network, address, abiText, name, exposed); add(contract, snapshot); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Contract registration failed'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function deploy(event: React.FormEvent) {
    event.preventDefault(); if (busyRef.current || status === 'unknown') return; busyRef.current = true; setBusy(true); setError(''); setMessage(''); setHash(undefined); setStatus('validating');
    const original = { project: structuredClone(project), form: { ...form } };
    pending.current = original;
    let confirmed: ContractConfig | undefined;
    try {
      const wallet = await getWalletClient(config);
      confirmed = await deployTemplate(original.project.network, original.form, wallet, review, (next, txHash) => { setStatus(next); if (txHash) setHash(txHash); });
      setStatus('succeeded'); add(confirmed, original.project);
    } catch (caught) {
      if (confirmed) {
        setStatus('succeeded'); setError(`Deployment confirmed at ${confirmed.address}, but the local project update failed. Import this address manually; do not redeploy.`);
      } else {
        setStatus(caught instanceof ActionError ? caught.status : 'failed'); setError(caught instanceof ActionError ? caught.message : 'Deployment could not be prepared. Connect a Fuji wallet and check the form values.');
      }
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function reconcile() {
    if (!hash || !pending.current || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const original = pending.current;
      if (readJournal().some(entry => entry.chainId === original.project.network.chainId && entry.hash === hash && entry.intent === 'different')) {
        setStatus('cancelled'); setError('This hash belongs to a different-intent replacement. Original-template recovery is disabled; nothing was registered.'); return;
      }
      const receipt = await checkReceipt(original.project.network, hash);
      if (!receipt) { setMessage('Receipt is still unknown. No deployment was retried.'); return; }
      if (receipt.status === 'reverted') { setStatus('reverted'); setError('Deployment reverted.'); return; }
      if (!receipt.contractAddress) { setStatus('cancelled'); setError('Transaction confirmed without a deployment address; it may have been replaced. Nothing was registered.'); return; }
      const selected = CONTRACT_TEMPLATES.find(item => item.templateId === original.form.templateId)!;
      const contract = await registerContract(original.project.network, receipt.contractAddress, JSON.stringify(selected.abi), original.form.name);
      setStatus('succeeded'); setError(''); add({ ...contract, templateId: selected.templateId }, original.project);
    } catch { setError('Receipt or code verification is still unavailable. Do not redeploy automatically.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function downloadTemplate(abiOnly: boolean) {
    const artifact = TEMPLATE_MANIFESTS[form.templateId as keyof typeof TEMPLATE_MANIFESTS];
    const url = URL.createObjectURL(new Blob([JSON.stringify(abiOnly ? artifact.abi : artifact, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${template.name}-${abiOnly ? 'abi' : 'artifact'}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="rt-app rt-contract-manager" aria-label="Contract configuration">
    <header><div><h2>Contracts</h2><p>Import existing code or deploy a narrowly scoped template on Fuji.</p></div><WalletControls /></header>
    <div className="rt-tabs"><button type="button" aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Import existing contract</button><button type="button" aria-pressed={tab === 'deploy'} onClick={() => setTab('deploy')}>Deploy template</button></div>
    {tab === 'import' ? <form onSubmit={event => void importContract(event)} className="rt-form"><h3>Verify address and ABI</h3><p>Read-only verification checks RPC chain identity and deployed code. It does not prove the supplied ABI matches the code.</p>
      <label className="rt-field">Name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Treasury token" /></label>
      <label className="rt-field">Contract address<input value={address} onChange={event => setAddress(event.target.value)} placeholder="0x…" required spellCheck={false} /></label>
      <label className="rt-field">ABI JSON<textarea value={abiText} onChange={event => { setAbiText(event.target.value); setFunctions([]); setExposed([]); }} rows={7} required placeholder="Paste the ABI array or a contract artifact containing an abi field" spellCheck={false} /></label>
      <p className="rt-meta">Paste the ABI array or the contents of a downloaded artifact JSON. Only the ABI is imported. JSON input: up to 1 MiB; extracted ABI: up to 200 KiB.</p>
      <button type="button" onClick={inspectAbi}>Inspect ABI functions</button>
      {!!functions.length && <fieldset><legend>Functions exposed to this project</legend>{functions.map(fn => <label className="rt-function" key={fn.signature}><input type="checkbox" disabled={!fn.supported} checked={exposed.includes(fn.signature)} onChange={event => setExposed(previous => event.target.checked ? [...previous, fn.signature] : previous.filter(signature => signature !== fn.signature))} /><span><code>{fn.signature}</code> · {fn.stateMutability}{!fn.supported && <small>{fn.reason}</small>}</span></label>)}</fieldset>}
      <button type="submit" className="rt-primary" disabled={busy || !functions.length}>{busy ? 'Checking chain…' : 'Verify and register contract'}</button>
    </form> : <form onSubmit={event => void deploy(event)} className="rt-form"><h3>Deploy on Avalanche Fuji</h3><p className="rt-warning">Testnet only. These templates are not audited. Deployment costs Fuji AVAX gas and cannot be undone.</p>
      <label className="rt-field">Template<select value={form.templateId} onChange={event => setForm(previous => ({ ...previous, templateId: event.target.value }))}>{CONTRACT_TEMPLATES.map(item => <option key={item.templateId} value={item.templateId}>{item.name} · v{item.version}</option>)}</select></label>
      <p>{template.permissions}</p><p className="rt-meta">Solidity {template.compiler}; OpenZeppelin {template.dependencies['@openzeppelin/contracts']}; Cancun EVM. Explorer source verification is not automatic.</p><div className="rt-actions"><button type="button" onClick={() => downloadTemplate(true)}>Download ABI JSON</button><button type="button" onClick={() => downloadTemplate(false)}>Download source, ABI and artifact manifest</button></div>
      <div className="rt-form-row"><label className="rt-field">Token name<input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required maxLength={100} /></label><label className="rt-field">Symbol<input value={form.symbol} onChange={event => setForm(previous => ({ ...previous, symbol: event.target.value }))} required maxLength={20} /></label></div>
      <label className="rt-field">{form.templateId === 'erc20-fixed-v1' ? 'Initial supply recipient' : 'Initial owner (mint authority)'}<input value={form.owner} onChange={event => setForm(previous => ({ ...previous, owner: event.target.value }))} placeholder="0x…" required spellCheck={false} /></label>
      {form.templateId === 'erc20-fixed-v1' && <label className="rt-field">Fixed supply (token units, 18 decimals)<input value={form.supply} onChange={event => setForm(previous => ({ ...previous, supply: event.target.value }))} required inputMode="decimal" /></label>}
      <button type="submit" className="rt-primary" disabled={busy || status === 'unknown' || project.network.chainId !== 43113}>{busy ? status.replaceAll('_', ' ') : 'Simulate and review deployment'}</button>
      {project.network.chainId !== 43113 && <p role="alert">Change the project network to Fuji to deploy. Mainnet and custom-chain deployments are disabled.</p>}
    </form>}
    {error && <p role="alert" className="rt-error">{error}</p>}{message && <p role="status" className="rt-message">{message}</p>}
    {hash && <div className="rt-run"><p>Deployment transaction · {status.replaceAll('_', ' ')}</p><code className="rt-address">{hash}</code>{status === 'unknown' && <button type="button" disabled={busy} onClick={() => void reconcile()}>Check deployment status (no resubmission)</button>}</div>}
    <section><h3>Project contracts ({project.contracts.length})</h3>{project.contracts.map(contract => <article className="rt-contract-card" key={contract.id}><strong>{contract.name}</strong><code className="rt-address">{contract.address}</code><small>Chain {contract.chainId} · {contract.exposedFunctions.length} exposed functions · source not verified</small></article>)}{!project.contracts.length && <p>No contracts registered. Import an address and ABI or deploy a Fuji template.</p>}</section>
    <TransactionReviewDialog intent={locked ? null : intent} answer={answer} />
  </section>;
}
export function ContractManager(props: Props) { return <Web3Providers><ContractManagerBody {...props} /></Web3Providers>; }
export default ContractManager;
