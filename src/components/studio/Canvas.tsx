'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowUpRight, GripVertical, Plus, Wallet } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { UIBlockNode } from '@/lib/schema/types';
import { useStudioStore } from '@/store/useStudioStore';

function CanvasBlock({ block, root = false }: { block: UIBlockNode; root?: boolean }) {
  const selectedId = useStudioStore(s => s.selectedId);
  const selectBlock = useStudioStore(s => s.selectBlock);
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({ id: `block:${block.id}`, data: { blockId: block.id }, disabled: root });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `container:${block.id}`, data: { parentId: block.id }, disabled: block.type !== 'Container' });
  const selected = selectedId === block.id;
  const text = (key: string, fallback: string) => String(block.props[key] ?? fallback);
  const style = block.styles as CSSProperties;
  let content;
  switch (block.type) {
    case 'Container': content = <div className={`authored-container ${root ? 'authored-root' : ''}`} style={style}>{block.children?.map(child => <CanvasBlock key={child.id} block={child} />)}{!block.children?.length && <div className="empty-container"><Plus size={18} /><span>Add or drop a block here</span></div>}</div>; break;
    case 'Heading': { const Tag = Number(block.props.level) === 1 ? 'h1' : Number(block.props.level) === 3 ? 'h3' : 'h2'; content = <Tag style={style}>{text('text', 'Your heading')}</Tag>; break; }
    case 'Text': content = <p style={style}>{text('text', 'A little context goes a long way.')}</p>; break;
    case 'Input': content = <div className="authored-field" style={style}><span>{text('label', 'Input')}</span><div className="inert-input">{text('value', '') || text('placeholder', 'Enter a value')}</div></div>; break;
    case 'ConnectWallet': content = <div className="authored-wallet" style={style}><Wallet size={16} />{text('label', 'Connect wallet')}</div>; break;
    case 'ContractRead': content = <div className="authored-read" style={style}><span>{text('label', 'Contract value')}</span><strong>—</strong><small>Connect a contract in the inspector</small></div>; break;
    default: content = <div className={`authored-button ${block.props.variant === 'secondary' ? 'secondary' : ''}`} style={style}>{text('label', block.type === 'ContractWrite' ? 'Submit transaction' : 'Button')}<ArrowUpRight size={16} /></div>;
  }
  return <div ref={node => { setDragRef(node); setDropRef(node); }} className={`canvas-block ${selected ? 'is-selected' : ''} ${isOver ? 'is-drop-target' : ''} ${isDragging ? 'is-dragging' : ''} ${root ? 'canvas-root' : ''}`} role="group" aria-label={`${block.type}: ${text('text', text('label', block.id))}`} tabIndex={0} onClick={event => { event.stopPropagation(); selectBlock(block.id); }} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); selectBlock(block.id); } }}><span className="block-selection-tag">{block.type}</span>{selected && !root && <button className="block-drag-handle" aria-label={`Drag ${block.type}`} {...attributes} {...listeners}><GripVertical size={14} /></button>}{content}</div>;
}

export function Canvas() {
  const project = useStudioStore(s => s.project);
  return <div className="editor-document"><CanvasBlock block={project.uiTree} root /></div>;
}
