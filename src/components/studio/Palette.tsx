'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowUpRight, Component, FormInput, Heading, Layers, MousePointer2, Plus, Square, Type, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { findBlock } from '@/lib/schema';
import type { BlockType, UIBlockNode } from '@/lib/schema/types';

export const blockIcons = { Container: Square, Heading, Text: Type, Input: FormInput, Button: MousePointer2, ConnectWallet: Wallet, ContractRead: Component, ContractWrite: ArrowUpRight };
const blockLabels: Record<BlockType, string> = { Container: 'Container', Heading: 'Heading', Text: 'Text', Input: 'Input', Button: 'Button', ConnectWallet: 'Connect wallet', ContractRead: 'Contract read', ContractWrite: 'Contract write' };

function PaletteItem({ type }: { type: BlockType }) {
  const store = useStudioStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, data: { type } });
  const Icon = blockIcons[type];
  return <button ref={setNodeRef} className={`palette-item ${isDragging ? 'is-dragging' : ''}`} {...attributes} {...listeners} onClick={() => { const selected = store.selectedId ? findBlock(store.project.uiTree, store.selectedId) : undefined; store.addBlock(type, selected?.type === 'Container' ? selected.id : undefined); }}><Icon size={21} strokeWidth={1.55} /><span>{blockLabels[type]}</span><Plus className="palette-plus" size={12} /></button>;
}
function Layer({ block, depth = 0 }: { block: UIBlockNode; depth?: number }) {
  const selectedId = useStudioStore(s => s.selectedId);
  const select = useStudioStore(s => s.selectBlock);
  const { setNodeRef, isOver } = useDroppable({ id: `layer:${block.id}`, data: { parentId: block.id }, disabled: block.type !== 'Container' });
  const Icon = blockIcons[block.type];
  return <li ref={setNodeRef}><button className={`layer-row ${selectedId === block.id ? 'selected' : ''} ${isOver ? 'drop-over' : ''}`} style={{ paddingLeft: 12 + depth * 12 }} onClick={() => select(block.id)}><Icon size={15} /><span>{String(block.props.label ?? block.props.text ?? block.type).slice(0, 32)}</span></button>{block.children?.length ? <ul>{block.children.map(child => <Layer key={child.id} block={child} depth={depth + 1} />)}</ul> : null}</li>;
}
export function Palette() {
  const [tab, setTab] = useState<'blocks' | 'layers'>('blocks');
  const project = useStudioStore(s => s.project);
  return <aside className="studio-panel palette-panel" aria-label="Blocks and layers"><div className="panel-heading"><h2>Build your interface</h2><Plus size={16} /></div><div className="panel-tabs" role="tablist" aria-label="Palette views"><button role="tab" aria-selected={tab === 'blocks'} className={tab === 'blocks' ? 'active' : ''} onClick={() => setTab('blocks')}>Blocks</button><button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}><Layers size={13} /> Layers</button></div>{tab === 'blocks' ? <><div className="palette-section"><h3 className="eyebrow">ESSENTIALS</h3><div className="palette-grid">{(['Container', 'Heading', 'Text', 'Input', 'Button'] as BlockType[]).map(type => <PaletteItem type={type} key={type} />)}</div></div><div className="palette-section"><h3 className="eyebrow">ONCHAIN</h3><div className="palette-grid onchain-grid">{(['ConnectWallet', 'ContractRead', 'ContractWrite'] as BlockType[]).map(type => <PaletteItem type={type} key={type} />)}</div></div><div className="panel-tip"><span className="small-dot" /><p>Click to add. Drag to place.<br />Select a container to nest blocks inside it.</p></div></> : <div className="layers-list"><p className="muted-help">Your page, from the outside in.</p><ul><Layer block={project.uiTree} /></ul></div>}</aside>;
}
