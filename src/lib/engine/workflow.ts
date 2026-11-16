import type { ImpactorProjectSchema, WorkflowNode, ContractActionConfig, StateVariable } from '../schema/types';
import { validateProject } from '../schema';
import { displayValue, resolveBinding, type BindingContext } from './bindings';

export type StepStatus = 'idle' | 'validating' | 'awaiting_consent' | 'awaiting_wallet' | 'submitted' | 'confirming' | 'succeeded' | 'rejected' | 'reverted' | 'cancelled' | 'failed' | 'unknown';
export interface RunStep { nodeId: string; label: string; status: StepStatus; txHash?: `0x${string}`; chainStatus?: 'success' | 'reverted'; error?: string }
export interface RuntimeRun { id: string; chainId: number; account?: string; startedAt: number; steps: RunStep[]; cancelled: boolean; active: boolean }
export type Progress = (status: StepStatus, hash?: `0x${string}`) => void;
export interface ExecutionPorts {
  read(action: ContractActionConfig, context: BindingContext): Promise<unknown>;
  write(action: ContractActionConfig, context: BindingContext, progress: Progress, cancelled: () => boolean): Promise<`0x${string}`>;
  feedback(message: string): void;
  updateState(state: Record<string, unknown>): void;
}
export class ActionError extends Error {
  constructor(message: string, public readonly status: StepStatus) { super(message); this.name = 'ActionError'; }
}
function ordered(project: ImpactorProjectSchema, triggerBlockId: string): WorkflowNode[] {
  const { nodes, edges } = project.workflows;
  const start = nodes.find(node => node.type === 'ui_trigger' && node.config.blockId === triggerBlockId && node.config.event === 'onClick');
  if (!start) return [];
  const result: WorkflowNode[] = []; const visited = new Set<string>(); let current: WorkflowNode | undefined = start;
  while (current) {
    if (visited.has(current.id)) throw new Error('Workflow contains a cycle');
    visited.add(current.id); result.push(current);
    const next = edges.filter(edge => edge.source === current?.id);
    if (next.length > 1) throw new Error('Workflow branches are not supported');
    current = next.length ? nodes.find(node => node.id === next[0].target) : undefined;
    if (current && edges.filter(edge => edge.target === current?.id).length !== 1) throw new Error('Workflow merges are not supported');
  }
  return result;
}
function setVariable(definitions: StateVariable[], state: Record<string, unknown>, name: string, value: unknown) {
  const definition = definitions.find(variable => variable.name === name);
  if (!definition) throw new Error(`Unknown state variable: ${name}`);
  if (definition.type === 'string') state[name] = displayValue(value);
  else if (definition.type === 'boolean') {
    if (value !== true && value !== false && value !== 'true' && value !== 'false') throw new Error(`${name} requires a boolean`);
    state[name] = value === true || value === 'true';
  } else {
    const text = displayValue(value);
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`${name} requires a number`);
    const number = Number(text);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || (typeof value === 'bigint' && BigInt(number) !== value)) throw new Error(`${name} cannot safely hold this quantity. Use a string variable.`);
    state[name] = number;
  }
}
/** One engine per mounted application instance. Unknown receipts lock new runs until read-only reconciliation. */
export class WorkflowEngine {
  private run: RuntimeRun | undefined;
  private lockedUnknown = false;
  constructor(private readonly listener?: (run: RuntimeRun) => void) {}
  get activeRun(): RuntimeRun | undefined { return this.run; }
  get busy(): boolean { return Boolean(this.run?.active) || this.lockedUnknown; }
  cancel(): void { if (this.run?.active) { this.run.cancelled = true; this.emit(); } }
  reconcile(hash: string, status: 'success' | 'reverted'): void {
    const step = this.run?.steps.find(item => item.txHash === hash && item.status === 'unknown');
    if (!step) return;
    step.status = status === 'success' ? 'succeeded' : 'reverted';
    step.chainStatus = status;
    this.lockedUnknown = false; this.emit(); // Never resumes downstream actions or requests another signature.
  }
  private emit(): void { if (this.run) this.listener?.({ ...this.run, steps: this.run.steps.map(step => ({ ...step })) }); }
  async execute(projectInput: ImpactorProjectSchema, triggerBlockId: string, values: BindingContext, ports: ExecutionPorts, direct?: { type: 'contract_read' | 'contract_write'; config: ContractActionConfig }): Promise<RuntimeRun> {
    if (this.busy) throw new Error('A run is active or has an unresolved transaction. Check its status first.');
    const validated = validateProject(projectInput);
    if (!validated.success) throw new Error(validated.issues.map(issue => issue.message).join('; '));
    const project = structuredClone(validated.project);
    const context: BindingContext = { state: { ...values.state }, inputs: structuredClone(values.inputs), wallet: { ...values.wallet }, steps: Object.create(null) as BindingContext['steps'] };
    const nodes: WorkflowNode[] = direct ? [{ id: triggerBlockId, type: direct.type, config: structuredClone(direct.config), label: direct.type === 'contract_read' ? 'Read contract' : 'Write contract', position: { x: 0, y: 0 } }] : ordered(project, triggerBlockId);
    if (!nodes.length) throw new Error('No workflow is configured for this button');
    if (nodes.length > 51) throw new Error('Workflow exceeds 50 action steps');
    // Validate every write output before any earlier step can submit an irreversible action.
    for (const node of nodes) {
      if (node.type === 'contract_write' && node.config.outputVariable && project.variables.find(variable => variable.name === node.config.outputVariable)?.type !== 'string') {
        throw new Error('Write output variables must be declared string variables for transaction hashes. Nothing was submitted.');
      }
    }
    this.run = { id: crypto.randomUUID(), chainId: project.network.chainId, account: context.wallet.address, startedAt: Date.now(), steps: nodes.map(node => ({ nodeId: node.id, label: node.label, status: 'idle' })), cancelled: false, active: true };
    this.emit();
    let current: RunStep | undefined;
    try {
      for (let index = 0; index < nodes.length; index += 1) {
        if (this.run.cancelled) break;
        const node = nodes[index]; current = this.run.steps[index]; current.status = 'validating'; this.emit();
        if (node.type === 'ui_trigger') { current.status = 'succeeded'; this.emit(); continue; }
        if (node.type === 'ui_feedback') {
          if (node.config.variable && node.config.value !== undefined) setVariable(project.variables, context.state, node.config.variable, resolveBinding(node.config.value, context));
          ports.feedback(displayValue(resolveBinding(node.config.message, context)));
        } else {
          let result: unknown;
          if (node.type === 'contract_read') result = await ports.read(node.config, context);
          else {
            const hash = await ports.write(node.config, context, (status, hash) => { if (current) { current.status = status; if (hash) current.txHash = hash; this.emit(); } }, () => Boolean(this.run?.cancelled));
            result = hash; current.chainStatus = 'success'; current.txHash = hash; current.status = 'succeeded';
            this.emit(); // Chain success is final for this run even if a later local effect fails.
          }
          context.steps[node.id] = { output: result, ...(node.type === 'contract_write' ? { txHash: String(result) } : {}) };
          if (node.config.outputVariable) setVariable(project.variables, context.state, node.config.outputVariable, result);
        }
        current.status = 'succeeded'; ports.updateState({ ...context.state }); this.emit();
      }
    } catch (error) {
      if (current) {
        if (current.chainStatus === 'success') {
          current.status = 'succeeded';
          current.error = 'Transaction confirmed, but a local state/display update failed. Remaining actions stopped. Do not resubmit the transaction.';
        } else {
          current.status = error instanceof ActionError ? error.status : 'failed';
          if (current.status === 'reverted') current.chainStatus = 'reverted';
          current.error = error instanceof Error ? error.message : 'Action could not be completed';
        }
        this.lockedUnknown = current.status === 'unknown';
      }
    } finally {
      this.run.steps.forEach(step => { if (step.status === 'idle') step.status = 'cancelled'; });
      this.run.active = false; this.emit();
    }
    return this.run;
  }
}
