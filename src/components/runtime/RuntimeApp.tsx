'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { formatUnits } from 'viem';
import type { ArgumentBinding, AvalancheNetworkConfig, ContractActionConfig, ContractConfig, ImpactorProjectSchema, JsonValue, UIBlockNode } from '../../lib/schema/types';
import { validateProject, flattenBlocks } from '../../lib/schema';
import { displayValue, resolveBinding, type BindingContext } from '../../lib/engine/bindings';
import { WorkflowEngine, type RuntimeRun } from '../../lib/engine/workflow';
import { readContract } from '../../lib/web3/contracts';
import { writeContract, checkReceipt, readJournal, journal, type JournalEntry } from '../../lib/web3/transactions';
import { Web3Providers } from '../providers/Web3Providers';
import { WalletControls } from './WalletControls';
import { TransactionReviewDialog, useTransactionReview } from './TransactionReview';
import './runtime.css';

function actionFor(block: UIBlockNode): ContractActionConfig {
  const args = block.props.args;
  if (!Array.isArray(args) || !args.every(arg => typeof arg === 'object' && arg !== null && !Array.isArray(arg) && typeof arg.value === 'string' && (arg.decimals === undefined || typeof arg.decimals === 'number'))) throw new Error('Contract arguments must be configured first');
  return { contractId: String(block.props.contractId ?? ''), functionSignature: String(block.props.functionSignature ?? ''), args: args as unknown as ArgumentBinding[],
    ...(typeof block.props.value === 'string' ? { value: block.props.value } : {}), ...(typeof block.props.outputVariable === 'string' ? { outputVariable: block.props.outputVariable } : {}) };
}
function initialInputs(project: ImpactorProjectSchema): BindingContext['inputs'] {
  return Object.fromEntries(flattenBlocks(project.uiTree).filter(block => block.type === 'Input').map(block => [block.id, { value: String(block.props.value ?? '') }]));
}
function RuntimeBody({ project }: { project: ImpactorProjectSchema }) {
  const config = useConfig();
  const account = useAccount();
  const validation = useMemo(() => validateProject(project), [project]);
  const safeProject = validation.success ? validation.project : undefined;
  const [state, setState] = useState<Record<string, unknown>>(() => Object.fromEntries((safeProject?.variables ?? []).map(variable => [variable.name, variable.initialValue])));
  const [inputs, setInputs] = useState<BindingContext['inputs']>({});
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<RuntimeRun>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<JournalEntry[]>([]);
  const [checking, setChecking] = useState(false);
  const engine = useRef<WorkflowEngine | null>(null);
  if (!engine.current) engine.current = new WorkflowEngine(setRun);
  const runNetwork = useRef<AvalancheNetworkConfig>(structuredClone(project.network));
  const runProject = useRef(project);
  const sessionProject = useRef(project);
  const latestProject = useRef(project); latestProject.current = project;
  const loadedReads = useRef(new Map<string, { contract: ContractConfig; action: ContractActionConfig; context: BindingContext }>());
  const { intent, review, answer } = useTransactionReview();
  const busy = engine.current.busy;
  useEffect(() => {
    // Keep the engine and original receipt monitor mounted while a signature or receipt is unresolved.
    if (sessionProject.current === project || engine.current?.busy) return;
    sessionProject.current = project;
    loadedReads.current.clear();
    setState(Object.fromEntries((safeProject?.variables ?? []).map(variable => [variable.name, variable.initialValue])));
    setInputs({}); setOutputs({}); setRun(undefined); setHistory([]); setError(''); setMessage('');
  }, [project, safeProject, busy]);
  const context: BindingContext = { state: { ...Object.fromEntries((safeProject?.variables ?? []).map(variable => [variable.name, variable.initialValue])), ...state }, inputs: { ...(safeProject ? initialInputs(safeProject) : {}), ...inputs }, wallet: { address: account.address, chainId: account.chainId }, steps: {} };
  if (safeProject) {
    for (const block of flattenBlocks(safeProject.uiTree)) {
      if (block.type === 'Input' && !Object.hasOwn(inputs, block.id)) {
        const value = block.bindings?.value ?? String(block.props.value ?? '');
        try { context.inputs[block.id] = { value: displayValue(resolveBinding(value, context)) }; }
        catch { delete context.inputs[block.id]; } // Unresolved input bindings fail instead of becoming zero/empty chain arguments.
      }
    }
  }
  async function refreshReads(network: AvalancheNetworkConfig, original: ImpactorProjectSchema) {
    if (latestProject.current !== original) return;
    await Promise.all([...loadedReads.current].map(async ([id, cached]) => {
      try {
        const result = await readContract(network, cached.contract, cached.action, cached.context);
        if (latestProject.current === original) setOutputs(previous => ({ ...previous, [id]: result }));
      } catch {
        if (latestProject.current === original) setError('Transaction confirmed, but a previously loaded read could not refresh. Refresh it manually.');
      }
    }));
  }
  async function execute(block: UIBlockNode) {
    if (engine.current?.busy) return;
    setError(''); setMessage('');
    const snapshot = structuredClone(project);
    runNetwork.current = snapshot.network;
    runProject.current = project;
    try {
      const hasWorkflow = snapshot.workflows.nodes.some(node => node.type === 'ui_trigger' && node.config.blockId === block.id);
      const direct = !hasWorkflow && (block.type === 'ContractRead' || block.type === 'ContractWrite') ? { type: block.type === 'ContractRead' ? 'contract_read' as const : 'contract_write' as const, config: actionFor(block) } : undefined;
      await engine.current?.execute(snapshot, block.id, context, {
        read: async (action, values) => {
          const contract = snapshot.contracts.find(item => item.id === action.contractId);
          if (!contract) throw new Error('Contract is not configured');
          const result = await readContract(snapshot.network, contract, action, values);
          if (latestProject.current === project) {
            if (block.type === 'ContractRead') loadedReads.current.set(block.id, { contract, action, context: structuredClone(values) });
            setOutputs(previous => ({ ...previous, [block.id]: result }));
          }
          return result;
        },
        write: async (action, values, progress, cancelled) => {
          const contract = snapshot.contracts.find(item => item.id === action.contractId);
          if (!contract) throw new Error('Contract is not configured');
          const wallet = await getWalletClient(config);
          const hash = await writeContract(snapshot.network, contract, action, values, wallet, review, progress, cancelled);
          await refreshReads(snapshot.network, project);
          return hash;
        }, feedback: setMessage, updateState: setState,
      }, direct);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Action could not be started'); }
  }
  async function check(hash: `0x${string}`) {
    setChecking(true);
    const originalNetwork = run?.steps.some(step => step.txHash === hash) ? runNetwork.current : project.network;
    const receipt = await checkReceipt(originalNetwork, hash);
    if (receipt) {
      if (receipt.status === 'success' && run?.steps.some(step => step.txHash === hash)) await refreshReads(originalNetwork, runProject.current);
      engine.current?.reconcile(hash, receipt.status);
      journal({ hash, chainId: originalNetwork.chainId, kind: 'write', status: receipt.status, timestamp: Date.now() });
      setMessage(`Transaction ${receipt.status === 'success' ? 'confirmed' : 'reverted'}. No interrupted workflow was resumed.`);
      setHistory(readJournal().filter(entry => entry.chainId === project.network.chainId));
    } else setMessage('Receipt is still unavailable. This does not mean the transaction failed.');
    setChecking(false);
  }
  function prop(block: UIBlockNode, key: string, fallback: JsonValue = ''): unknown {
    const value = block.bindings?.[key] ?? block.props[key] ?? fallback;
    return typeof value === 'string' ? resolveBinding(value, context) : value;
  }
  function render(block: UIBlockNode): React.ReactNode {
    const style = block.styles as CSSProperties;
    try {
      switch (block.type) {
        case 'Container': return <div key={block.id} className="rt-container" style={style}>{block.children?.map(render)}</div>;
        case 'Heading': { const level = Number(block.props.level ?? 2); const text = displayValue(prop(block, 'text', 'Heading')); return level === 1 ? <h1 key={block.id} style={style}>{text}</h1> : level === 3 ? <h3 key={block.id} style={style}>{text}</h3> : <h2 key={block.id} style={style}>{text}</h2>; }
        case 'Text': return <p key={block.id} style={style}>{displayValue(prop(block, 'text'))}</p>;
        case 'Input': return <label key={block.id} className="rt-field" style={style}>{displayValue(prop(block, 'label', 'Input'))}<input type={String(block.props.inputType ?? 'text')} placeholder={String(block.props.placeholder ?? '')} value={context.inputs[block.id]?.value ?? ''} onChange={event => setInputs(previous => ({ ...previous, [block.id]: { value: event.target.value } }))} /></label>;
        case 'ConnectWallet': return <div key={block.id} style={style}><WalletControls /></div>;
        case 'Button': return <button type="button" key={block.id} className="rt-primary" style={style} disabled={busy} onClick={() => void execute(block)}>{displayValue(prop(block, 'label', 'Run workflow'))}</button>;
        case 'ContractWrite': return <button type="button" key={block.id} className="rt-primary" style={style} disabled={busy || project.network.chainId !== 43113} onClick={() => void execute(block)}>{displayValue(prop(block, 'label', 'Review transaction'))}</button>;
        case 'ContractRead': { const value = outputs[block.id]; const formatted = typeof value === 'bigint' && typeof block.props.decimals === 'number' ? formatUnits(value, block.props.decimals) : value === undefined ? 'Not loaded' : displayValue(value); return <div className="rt-read" key={block.id} style={style}><span>{displayValue(prop(block, 'label', 'Contract value'))}</span><output>{formatted}</output><button type="button" disabled={busy} onClick={() => void execute(block)}>Refresh read</button></div>; }
      }
    } catch { return <p key={block.id} role="alert" className="rt-error">Block {block.id}: a binding has no valid value yet. Connect a wallet or complete the required input.</p>; }
  }
  return <section className="rt-app" aria-label={`${project.name} runtime`}>
    <div className="rt-runtime-bar"><span>Interactive preview · {project.network.name}</span><WalletControls /></div>
    {project.network.chainId !== 43113 && <p className="rt-warning">This network is read-only in P0. Writes and deployments require Avalanche Fuji.</p>}
    {!validation.success ? <div role="alert" className="rt-error"><h3>Complete project configuration before running</h3><ul>{validation.issues.slice(0, 12).map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul></div> : <div className="rt-canvas">{render(project.uiTree)}</div>}
    {error && <p className="rt-error" role="alert">{error}</p>}{message && <p className="rt-message" role="status">{message}</p>}
    {run && <section className="rt-run" aria-label="Run status" aria-live="polite"><header><h3>{run.active ? 'Run in progress' : run.steps.some(step => step.status === 'unknown') ? 'Transaction status unknown' : 'Run finished'}</h3>{run.active && <button type="button" onClick={() => { engine.current?.cancel(); answer(false); }}>Stop unstarted actions</button>}</header><p>Chain {run.chainId}. Cancellation cannot undo a submitted transaction.</p><ol>{run.steps.map(step => <li key={step.nodeId}><strong>{step.label}</strong> <span>{step.status.replaceAll('_', ' ')}</span>{step.txHash && <code className="rt-address">{step.txHash}</code>}{step.error && <p className="rt-error">{step.error}</p>}{step.status === 'unknown' && step.txHash && <button type="button" disabled={checking} onClick={() => void check(step.txHash!)}>Check status (read only)</button>}</li>)}</ol></section>}
    <details className="rt-history"><summary>Recover known transactions</summary><p>Local hashes only; storage can be cleared or unavailable. Checking never resumes signatures or downstream actions.</p><button type="button" onClick={() => setHistory(readJournal().filter(entry => entry.chainId === project.network.chainId))}>Load local transaction journal</button>{history.map(entry => <div key={entry.hash}><code className="rt-address">{entry.hash}</code><span>{entry.kind} · {entry.status}</span><button type="button" disabled={checking} onClick={() => void check(entry.hash)}>Check status</button></div>)}</details>
    <TransactionReviewDialog intent={intent} answer={answer} />
  </section>;
}
export function RuntimeApp({ project }: { project: ImpactorProjectSchema }) {
  return <Web3Providers><RuntimeBody project={project} /></Web3Providers>;
}
export default RuntimeApp;
