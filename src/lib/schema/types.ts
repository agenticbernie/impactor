import type { Abi } from 'viem';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const BLOCK_TYPES = ['Container', 'Heading', 'Text', 'Input', 'Button', 'ConnectWallet', 'ContractRead', 'ContractWrite'] as const;
export type BlockType = typeof BLOCK_TYPES[number];
export interface AvalancheNetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}
export interface UIBlockNode {
  id: string;
  type: BlockType;
  props: Record<string, JsonValue>;
  styles: Record<string, string>;
  bindings?: Record<string, string>;
  children?: UIBlockNode[];
}
export interface ContractConfig {
  id: string;
  name: string;
  chainId: number;
  address: `0x${string}`;
  abi: Abi;
  exposedFunctions: string[];
  templateId?: string;
}
export interface StateVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean';
  initialValue: string | number | boolean;
}
export interface ArgumentBinding {
  value: string;
  decimals?: number;
}
export interface ContractActionConfig {
  contractId: string;
  functionSignature: string;
  args: ArgumentBinding[];
  value?: string;
  outputVariable?: string;
}
export type WorkflowNode =
  | { id: string; type: 'ui_trigger'; label: string; position: { x: number; y: number }; config: { blockId: string; event: 'onClick' } }
  | { id: string; type: 'contract_read' | 'contract_write'; label: string; position: { x: number; y: number }; config: ContractActionConfig }
  | { id: string; type: 'ui_feedback'; label: string; position: { x: number; y: number }; config: { message: string; variable?: string; value?: string } };
export interface WorkflowEdge { id: string; source: string; target: string }
export interface WorkflowGraph { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export interface ImpactorProjectSchema {
  schemaVersion: 1;
  id: string;
  name: string;
  network: AvalancheNetworkConfig;
  contracts: ContractConfig[];
  variables: StateVariable[];
  uiTree: UIBlockNode;
  workflows: WorkflowGraph;
}
export interface ValidationIssue { path: string; message: string }
export type ValidationResult = { success: true; project: ImpactorProjectSchema; issues: [] } | { success: false; issues: ValidationIssue[] };
