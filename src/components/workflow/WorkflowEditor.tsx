'use client';

import { Background, Controls, ReactFlow, type Node, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDown, ArrowUp, Component, GitBranch, MessageSquare, MousePointer2, Plus, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { flattenBlocks, validateProject } from '@/lib/schema';
import type { WorkflowNode, WorkflowGraph } from '@/lib/schema/types';
import { BindingField, ContractFields } from '@/components/studio/ContractFields';

const names = { ui_trigger: 'Click trigger', contract_read: 'Read contract', contract_write: 'Write contract', ui_feedback: 'Show feedback' };
const icons = { ui_trigger: MousePointer2, contract_read: Component, contract_write: Zap, ui_feedback: MessageSquare };
function orderedChains(graph: WorkflowGraph): WorkflowNode[][] {
  const visited = new Set<string>();
  const chains: WorkflowNode[][] = [];
  for (const start of [...graph.nodes.filter(n => n.type === 'ui_trigger'), ...graph.nodes]) {
    if (visited.has(start.id)) continue;
    const chain: WorkflowNode[] = [];
    let current: WorkflowNode | undefined = start;
    while (current && !visited.has(current.id)) { visited.add(current.id); chain.push(current); const next = graph.edges.find(e => e.source === current?.id)?.target; current = graph.nodes.find(n => n.id === next); }
    chains.push(chain);
  }
  return chains;
}
function chainEdges(chains: WorkflowNode[][]) { return chains.flatMap(chain => chain.slice(1).map((node, index) => ({ id: `edge-${chain[index].id}-${node.id}`, source: chain[index].id, target: node.id }))); }

export function WorkflowEditor({ onError }: { onError: (error: string) => void }) {
  const store = useStudioStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const selected = store.project.workflows.nodes.find(n => n.id === selectedId);
  const chains = orderedChains(store.project.workflows);
  const selectedChain = chains.find(chain => chain.some(n => n.id === selectedId));
  const update = (node: WorkflowNode) => store.updateProject(draft => { const index = draft.workflows.nodes.findIndex(n => n.id === node.id); if (index >= 0) draft.workflows.nodes[index] = node; });
  const nodes: Node[] = store.project.workflows.nodes.map(node => { const Icon = icons[node.type]; return { id: node.id, type: node.type === 'ui_trigger' ? 'input' : 'default', position: node.position, selected: node.id === selectedId, className: `flow-node flow-${node.type}`, data: { label: <div className="flow-node-label"><span><Icon size={16} />{names[node.type]}</span><strong>{node.label}</strong><small>{node.type === 'ui_trigger' ? 'onClick' : node.type === 'ui_feedback' ? 'Visitor feedback' : node.config.functionSignature || 'Choose a function'}</small></div> } }; });
  const add = (type: WorkflowNode['type']) => {
    const id = `step_${crypto.randomUUID().slice(0, 8)}`;
    const tail = selectedChain?.at(-1) ?? chains.at(-1)?.at(-1);
    if (type !== 'ui_trigger' && !tail) { onError('Add a click trigger before adding an action.'); return; }
    const position = { x: type === 'ui_trigger' ? chains.length * 290 + 50 : tail?.position.x ?? 50, y: type === 'ui_trigger' ? 60 : (tail?.position.y ?? 60) + 150 };
    let node: WorkflowNode;
    if (type === 'ui_trigger') node = { id, type, label: 'When a button is clicked', position, config: { blockId: '', event: 'onClick' } };
    else if (type === 'ui_feedback') node = { id, type, label: 'Show a message', position, config: { message: 'Action completed.' } };
    else node = { id, type, label: names[type], position, config: { contractId: '', functionSignature: '', args: [] } };
    store.updateProject(draft => { draft.workflows.nodes.push(node); if (type !== 'ui_trigger' && tail) draft.workflows.edges.push({ id: `edge-${tail.id}-${id}`, source: tail.id, target: id }); });
    setSelectedId(id);
  };
  const remove = () => {
    if (!selected) return;
    if (selected.type === 'ui_trigger' && (selectedChain?.length ?? 0) > 1) { onError('Remove the actions in this chain before deleting its trigger.'); return; }
    const nextChains = chains.map(chain => chain.filter(n => n.id !== selected.id)).filter(chain => chain.length);
    store.updateProject(draft => { draft.workflows.nodes = draft.workflows.nodes.filter(n => n.id !== selected.id); draft.workflows.edges = chainEdges(nextChains); });
    setSelectedId(null);
  };
  const reorder = (node: WorkflowNode, direction: number) => {
    const chain = chains.find(c => c.some(n => n.id === node.id));
    if (!chain || node.type === 'ui_trigger') return;
    const index = chain.findIndex(n => n.id === node.id); const target = index + direction;
    if (target < 1 || target >= chain.length) return;
    [chain[index], chain[target]] = [chain[target], chain[index]];
    store.updateProject(draft => { draft.workflows.edges = chainEdges(chains); for (const group of chains) group.forEach((item, i) => { const entry = draft.workflows.nodes.find(n => n.id === item.id); if (entry) entry.position = { x: group[0].position.x, y: 60 + i * 150 }; }); });
  };
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const candidate = structuredClone(store.project);
    candidate.workflows.edges.push({ id: `edge-${connection.source}-${connection.target}`, source: connection.source, target: connection.target });
    const structuralIssues = validateProject(candidate).issues.filter(i => i.path.includes('edges') || /cycle|branch|predecessor|incoming|outgoing|orphan/i.test(i.message));
    if (structuralIssues.length) { onError(`Sequential workflows only. ${structuralIssues[0].message}`); return; }
    store.updateProject(draft => { draft.workflows.edges = candidate.workflows.edges; });
  };
  const issues = validateProject(store.project).issues.filter(i => i.path.includes('workflow'));
  return <div className="workflow-workspace"><aside className="studio-panel workflow-palette"><div className="panel-heading"><h2>Build your workflow</h2><GitBranch size={16} /></div><div className="workflow-palette-content"><p className="muted-help">One click. A clear sequence.<br />Add a trigger, then the next action.</p>{(Object.keys(names) as WorkflowNode['type'][]).map(type => { const Icon = icons[type]; return <button className="action-palette-item" onClick={() => add(type)} key={type}><span className={`action-icon action-${type}`}><Icon size={18} /></span><span>{names[type]}</span><Plus size={14} /></button>; })}<div className="panel-tip"><p>New actions append to the selected chain. Conditions, loops, and parallel actions are not supported.</p></div></div></aside><section className="workflow-center" aria-label="Workflow editor"><div className="workspace-toolbar"><span><GitBranch size={15} /> Interaction flow</span><div className="segmented-control"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>Graph</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Step list</button></div></div>{view === 'graph' ? <div className="flow-canvas"><ReactFlow nodes={nodes} edges={store.project.workflows.edges} onNodeClick={(_, node) => setSelectedId(node.id)} onNodeDragStop={(_, node) => { const original = store.project.workflows.nodes.find(n => n.id === node.id); if (original) update({ ...original, position: node.position }); }} onConnect={connect} fitView minZoom={0.3} maxZoom={1.5} deleteKeyCode={null} proOptions={{ hideAttribution: true }}><Background gap={20} size={1} /><Controls showInteractive={false} /></ReactFlow>{!nodes.length && <div className="flow-empty"><GitBranch size={34} /><h3>Turn an interface into an interaction.</h3><p>Start with a button click. Add exactly what happens next.</p><button className="button button-primary" onClick={() => add('ui_trigger')}><Plus size={16} /> Add click trigger</button></div>}</div> : <div className="workflow-step-list">{chains.map((chain, c) => <section key={chain[0].id}><h3>Sequence {c + 1}</h3><ol>{chain.map((node, index) => { const Icon = icons[node.type]; return <li key={node.id} className={selectedId === node.id ? 'selected' : ''}><button className="step-select" onClick={() => setSelectedId(node.id)}><span>{String(index + 1).padStart(2, '0')}</span><Icon size={17} /><div><strong>{node.label}</strong><small>{names[node.type]}</small></div></button>{node.type !== 'ui_trigger' && <div><button className="icon-button" disabled={index <= 1} aria-label={`Move ${node.label} up`} onClick={() => reorder(node, -1)}><ArrowUp size={15} /></button><button className="icon-button" disabled={index === chain.length - 1} aria-label={`Move ${node.label} down`} onClick={() => reorder(node, 1)}><ArrowDown size={15} /></button></div>}</li>; })}</ol><button className="button button-secondary" onClick={() => { setSelectedId(chain[0].id); }}><Plus size={14} /> Select chain to add an action</button></section>)}{!chains.length && <button className="button button-primary" onClick={() => add('ui_trigger')}>Add click trigger</button>}</div>}<details className="workflow-validation" open={issues.length > 0}><summary>{issues.length ? `${issues.length} configuration issue${issues.length === 1 ? '' : 's'} to resolve` : 'Sequential workflow · no validation issues'}</summary>{issues.length > 0 && <ul>{issues.slice(0, 12).map((issue, i) => <li key={i}><code>{issue.path}</code> {issue.message}</li>)}</ul>}<p>Configuration is validated again before execution or export. Reordered output bindings may need updating.</p></details></section><aside className="studio-panel workflow-inspector"><div className="panel-heading"><h2>Action settings</h2><SettingsIcon /></div>{selected ? <div className="inspector-scroll"><section className="inspector-section"><h3>{names[selected.type]}</h3><label className="field-label">Step name<input value={selected.label} onChange={e => update({ ...selected, label: e.target.value })} /></label><p className="block-id">ID <code>{selected.id}</code></p>{selected.type === 'ui_trigger' ? <label className="field-label">When this button is clicked<select value={selected.config.blockId} onChange={e => update({ ...selected, config: { blockId: e.target.value, event: 'onClick' } })}><option value="">Select a button</option>{flattenBlocks(store.project.uiTree).filter(b => b.type === 'Button').map(b => <option key={b.id} value={b.id}>{String(b.props.label ?? b.id)}</option>)}</select></label> : selected.type === 'ui_feedback' ? <><BindingField label="Message" value={selected.config.message} project={store.project} previousSteps={selectedChain?.slice(0, selectedChain.findIndex(n => n.id === selected.id)).map(n => n.id)} onChange={message => update({ ...selected, config: { ...selected.config, message } })} /><label className="field-label">Update state (optional)<select value={selected.config.variable ?? ''} onChange={e => { const config = { ...selected.config }; if (e.target.value) { config.variable = e.target.value; config.value ??= ''; } else { delete config.variable; delete config.value; } update({ ...selected, config }); }}><option value="">Message only</option>{store.project.variables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}</select></label>{selected.config.variable && <BindingField label="State value" value={selected.config.value ?? ''} project={store.project} onChange={value => update({ ...selected, config: { ...selected.config, value } })} />}</> : <ContractFields project={store.project} config={selected.config} read={selected.type === 'contract_read'} previousSteps={selectedChain?.slice(0, selectedChain.findIndex(n => n.id === selected.id)).map(n => n.id)} onChange={config => update({ ...selected, config })} />}</section><section className="inspector-section"><button className="button button-secondary danger-text" onClick={remove}><Trash2 size={15} /> Remove action</button></section></div> : <div className="inspector-empty"><MousePointer2 size={26} /><h3>Make every step explicit.</h3><p>Select an action to choose its contract, arguments, or feedback.</p></div>}</aside></div>;
}
function SettingsIcon() { return <Component size={16} />; }
