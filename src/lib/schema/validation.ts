import { z } from 'zod';
import { isAddress, parseUnits, toFunctionSignature, type AbiFunction, type AbiParameter } from 'viem';
import { BLOCK_TYPES, type ContractActionConfig, type ImpactorProjectSchema, type UIBlockNode, type ValidationIssue, type ValidationResult } from './types';
import { flattenBlocks } from './project';

export const PROJECT_LIMITS = { bytes: 1024 * 1024, blocks: 500, depth: 20, workflowNodes: 200, steps: 50, contracts: 100, variables: 200, abiEntries: 500 } as const;
const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).refine((v) => !dangerous.has(v), 'Reserved identifier');
const variableName = z.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((v) => !dangerous.has(v), 'Reserved name');
const text = z.string().max(10000);
const smallText = z.string().max(200);
const safeUrl = z.string().max(2048).refine((value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a public HTTPS URL without embedded credentials');
const argument = z.object({ value: text, decimals: z.number().int().min(0).max(255).optional() }).strict();
const action = z.object({ contractId: smallText, functionSignature: smallText, args: z.array(argument).max(32), value: text.optional(), outputVariable: variableName.optional() }).strict();
const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const commonNode = { id: identifier, label: smallText, position };
const workflowNode = z.discriminatedUnion('type', [
  z.object({ ...commonNode, type: z.literal('ui_trigger'), config: z.object({ blockId: smallText, event: z.literal('onClick') }).strict() }).strict(),
  z.object({ ...commonNode, type: z.literal('contract_read'), config: action }).strict(),
  z.object({ ...commonNode, type: z.literal('contract_write'), config: action }).strict(),
  z.object({ ...commonNode, type: z.literal('ui_feedback'), config: z.object({ message: text, variable: variableName.optional(), value: text.optional() }).strict() }).strict(),
]);
const abiType = z.string().min(1).max(200).refine((value) => {
  const base = value.replace(/(?:\[(?:[1-9]\d*)?\])+$/, '');
  return (primitive(base) || ['tuple', 'function', 'uint', 'int'].includes(base)) && (base === value || /^(?:\[(?:[1-9]\d*)?\])+$/.test(value.slice(base.length)));
}, 'Invalid ABI parameter type');
const parameter: z.ZodType<AbiParameter> = z.lazy(() => z.object({ name: smallText.optional(), type: abiType, internalType: smallText.optional(), components: z.array(parameter).max(32).optional() }).strict().refine((param) => !param.type.startsWith('tuple') || param.components !== undefined, 'Tuple parameters require components') as z.ZodType<AbiParameter>);
const params = z.array(parameter).max(32);
const mutability = z.enum(['pure', 'view', 'nonpayable', 'payable']);
const abiItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('function'), name: variableName, inputs: params, outputs: params, stateMutability: mutability }).strict(),
  z.object({ type: z.literal('constructor'), inputs: params, stateMutability: z.enum(['nonpayable', 'payable']) }).strict(),
  z.object({ type: z.literal('event'), name: variableName, inputs: z.array(z.object({ name: smallText.optional(), type: abiType, internalType: smallText.optional(), indexed: z.boolean().optional(), components: params.optional() }).strict()).max(32), anonymous: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('error'), name: variableName, inputs: params }).strict(),
  z.object({ type: z.literal('fallback'), stateMutability: z.enum(['nonpayable', 'payable']) }).strict(),
  z.object({ type: z.literal('receive'), stateMutability: z.literal('payable') }).strict(),
]);
const propValue = z.union([text, z.number().finite(), z.boolean(), z.null(), z.array(argument).max(32)]);
const block: z.ZodType<UIBlockNode> = z.lazy(() => z.object({
  id: identifier, type: z.enum(BLOCK_TYPES), props: z.record(z.string(), propValue), styles: z.record(z.string(), z.string().max(100)),
  bindings: z.record(z.string(), text).optional(), children: z.array(block).max(PROJECT_LIMITS.blocks).optional(),
}).strict());
const projectSchema = z.object({
  schemaVersion: z.literal(1), id: identifier, name: z.string().trim().min(1).max(100),
  network: z.object({ chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), name: smallText.min(1), rpcUrl: safeUrl, explorerUrl: safeUrl.optional(), nativeCurrency: z.object({ name: smallText.min(1), symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(255) }).strict() }).strict(),
  contracts: z.array(z.object({ id: identifier, name: smallText.min(1), chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), address: z.string().refine((v) => isAddress(v, { strict: true }), 'Invalid EVM address'), abi: z.array(abiItem).max(PROJECT_LIMITS.abiEntries), exposedFunctions: z.array(smallText.min(1)).max(100), templateId: smallText.optional() }).strict()).max(PROJECT_LIMITS.contracts),
  variables: z.array(z.object({ id: identifier, name: variableName, type: z.enum(['string', 'number', 'boolean']), initialValue: z.union([text, z.number().finite(), z.boolean()]) }).strict()).max(PROJECT_LIMITS.variables),
  uiTree: block,
  workflows: z.object({ nodes: z.array(workflowNode).max(PROJECT_LIMITS.workflowNodes), edges: z.array(z.object({ id: identifier, source: identifier, target: identifier }).strict()).max(PROJECT_LIMITS.workflowNodes) }).strict(),
}).strict();

/** Reject non-JSON objects and extreme nesting before recursive schema/JSON operations. */
function preflight(input: unknown): string | undefined {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length) {
    const { value, depth, exit } = stack.pop()!;
    if (exit) { seen.delete(value as object); continue; }
    if (++count > 60000 || depth > 64) return 'Project exceeds structural resource limits.';
    if (value === null || typeof value === 'boolean' || typeof value === 'string') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) return 'Nonfinite numbers are not JSON values.'; continue; }
    if (typeof value !== 'object') return 'Only JSON values are supported.';
    if (seen.has(value)) return 'Cyclic references are not supported.';
    seen.add(value);
    stack.push({ value, depth, exit: true });
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return 'Only plain JSON objects are supported.';
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (dangerous.has(key)) return 'Reserved object key is not supported.';
      if (descriptor.get || descriptor.set) return 'Accessor properties are not JSON data.';
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > PROJECT_LIMITS.bytes) return 'Project exceeds the 1 MiB limit.'; } catch { return 'Project cannot be serialized as JSON.'; }
}

const properties: Record<UIBlockNode['type'], readonly string[]> = {
  Container: [], Heading: ['text', 'level'], Text: ['text'], Input: ['label', 'placeholder', 'value', 'inputType'],
  Button: ['label', 'variant'], ConnectWallet: ['label'],
  ContractRead: ['label', 'contractId', 'functionSignature', 'args', 'decimals', 'outputVariable'], ContractWrite: ['label', 'variant', 'contractId', 'functionSignature', 'args', 'value', 'outputVariable'],
};
const bindingProperties: Record<UIBlockNode['type'], readonly string[]> = {
  Container: [], Heading: ['text'], Text: ['text'], Input: ['value'], Button: ['label'], ConnectWallet: ['label'], ContractRead: ['label'], ContractWrite: ['label'],
};
const dimension = /^(?:0|(?:\d{1,4}(?:\.\d{1,2})?)(?:px|rem|em|%|vh|vw))$/;
const color = /^(?:#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|transparent|inherit|currentColor|white|black)$/;
const styles: Record<string, (v: string) => boolean> = {
  padding: (v) => v.split(' ').length <= 4 && v.split(' ').every((n) => dimension.test(n)), gap: (v) => dimension.test(v),
  backgroundColor: (v) => color.test(v), color: (v) => color.test(v), fontSize: (v) => dimension.test(v), borderRadius: (v) => dimension.test(v),
  textAlign: (v) => ['left', 'center', 'right'].includes(v), display: (v) => ['flex', 'block', 'inline-block'].includes(v),
  flexDirection: (v) => ['row', 'column'].includes(v), alignItems: (v) => ['stretch', 'flex-start', 'center', 'flex-end'].includes(v),
  justifyContent: (v) => ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'].includes(v),
  maxWidth: (v) => dimension.test(v) || v === 'none', width: (v) => dimension.test(v) || v === 'auto',
};
function primitive(type: string): boolean {
  if (['address', 'bool', 'string', 'bytes'].includes(type)) return true;
  const int = /^(?:u?int)(\d+)$/.exec(type);
  if (int) return +int[1] >= 8 && +int[1] <= 256 && +int[1] % 8 === 0;
  const bytes = /^bytes(\d+)$/.exec(type);
  return !!bytes && +bytes[1] >= 1 && +bytes[1] <= 32;
}

function validConstant(value: string, type: string, decimals?: number): boolean {
  if (value.includes('{{')) return true; // Runtime resolves and validates dynamic values.
  if (type === 'string') return true;
  if (type === 'address') return isAddress(value, { strict: true });
  if (type === 'bool') return value === 'true' || value === 'false';
  if (type.startsWith('bytes')) return /^0x(?:[\da-fA-F]{2})*$/.test(value) && (type === 'bytes' || value.length === 2 + Number(type.slice(5)) * 2);
  const integer = /^(u?int)(\d+)$/.exec(type);
  if (!integer) return false;
  if (!(decimals === undefined ? /^-?\d+$/ : /^-?\d+(?:\.\d+)?$/).test(value)) return false;
  if (decimals !== undefined && (value.split('.')[1]?.length ?? 0) > decimals) return false;
  try {
    const amount = decimals === undefined ? BigInt(value) : parseUnits(value, decimals);
    const bits = BigInt(integer[2]); const unsigned = integer[1] === 'uint';
    return unsigned ? amount >= 0n && amount < 2n ** bits : amount >= -(2n ** (bits - 1n)) && amount < 2n ** (bits - 1n);
  } catch { return false; }
}

function validate(input: unknown, draft: boolean): ValidationResult {
  const issues: ValidationIssue[] = [];
  let semantic = false;
  const issue = (path: string, message: string) => { if (issues.length < 100 && !(draft && semantic)) issues.push({ path, message }); };
  try {
    const unsafe = preflight(input);
    if (unsafe) return { success: false, issues: [{ path: '', message: unsafe }] };
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) return { success: false, issues: parsed.error.issues.slice(0, 100).map((entry) => ({ path: entry.path.join('.'), message: entry.message })) };
    const project = parsed.data as ImpactorProjectSchema;
    const blocks = flattenBlocks(project.uiTree);
    if (blocks.length > PROJECT_LIMITS.blocks) issue('uiTree', 'At most 500 blocks are supported.');
    const unique = (items: { id: string }[], path: string) => {
      const ids = new Set<string>();
      for (const item of items) { if (ids.has(item.id)) issue(path, `Duplicate ID: ${item.id}`); ids.add(item.id); }
    };
    unique(blocks, 'uiTree'); unique(project.contracts, 'contracts'); unique(project.variables, 'variables'); unique(project.workflows.nodes, 'workflows.nodes'); unique(project.workflows.edges, 'workflows.edges');
    const names = new Set<string>();
    for (const variable of project.variables) {
      if (names.has(variable.name)) issue('variables', `Duplicate variable: ${variable.name}`);
      names.add(variable.name);
      if (typeof variable.initialValue !== variable.type) issue(`variables.${variable.id}`, 'Initial value must match the declared type.');
    }
    const depth = (node: UIBlockNode, level: number) => {
      if (level > PROJECT_LIMITS.depth) issue(`uiTree.${node.id}`, 'Block nesting exceeds 20 levels.');
      if (node.type !== 'Container' && node.children?.length) issue(`uiTree.${node.id}`, 'Only containers can contain children.');
      for (const child of node.children ?? []) depth(child, level + 1);
    };
    depth(project.uiTree, 1);
    const blockMap = new Map(blocks.map((b) => [b.id, b]));
    const nodeMap = new Map(project.workflows.nodes.map((n) => [n.id, n]));
    semantic = true;
    const functions = new Map<string, Map<string, AbiFunction>>();
    for (const contract of project.contracts) {
      const path = `contracts.${contract.id}`;
      if (contract.chainId !== project.network.chainId) issue(path, 'Contract chain must match the project network.');
      const entries = new Map<string, AbiFunction>();
      for (const entry of contract.abi) {
        if (entry.type !== 'function') continue;
        try {
          const signature = toFunctionSignature(entry);
          if (entries.has(signature)) issue(path, `Duplicate ABI signature: ${signature}`);
          entries.set(signature, entry);
        } catch { issue(path, 'Invalid ABI function signature.'); }
      }
      functions.set(contract.id, entries);
      if (new Set(contract.exposedFunctions).size !== contract.exposedFunctions.length) issue(path, 'Exposed signatures must be unique.');
      for (const signature of contract.exposedFunctions) {
        const fn = entries.get(signature);
        if (!fn) issue(path, `Exposed function must use an exact ABI signature: ${signature}`);
        else if (![...fn.inputs, ...fn.outputs].every((p) => primitive(p.type))) issue(path, `Unsupported interactive ABI type in ${signature}; only scalar parameters and outputs are supported.`);
      }
    }
    // Each chain is traversed from its trigger; the visited set catches orphan cycles.
    const incoming = new Map<string, string[]>(); const outgoing = new Map<string, string[]>();
    for (const edge of project.workflows.edges) {
      if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) issue(`workflows.edges.${edge.id}`, 'Edge references an unknown node.');
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    }
    const predecessors = new Map<string, Set<string>>();
    const visited = new Set<string>(); const triggers = new Set<string>();
    for (const node of project.workflows.nodes) {
      const ins = incoming.get(node.id) ?? []; const outs = outgoing.get(node.id) ?? [];
      if (outs.length > 1) issue(`workflows.${node.id}`, 'Branching is not supported.');
      if (node.type === 'ui_trigger') {
        if (ins.length) issue(`workflows.${node.id}`, 'Triggers cannot have incoming edges.');
        const target = blockMap.get(node.config.blockId);
        if (!target || !['Button', 'ContractWrite'].includes(target.type)) issue(`workflows.${node.id}`, 'Trigger must reference a Button or ContractWrite block.');
        if (triggers.has(node.config.blockId)) issue(`workflows.${node.id}`, 'A block event can have only one trigger.');
        triggers.add(node.config.blockId);
        const chain = new Set<string>(); let current: string | undefined = node.id;
        while (current) {
          if (chain.has(current)) { issue(`workflows.${current}`, 'Workflow cycles are not supported.'); break; }
          predecessors.set(current, new Set(chain)); chain.add(current); visited.add(current);
          current = outgoing.get(current)?.[0];
          if (chain.size > PROJECT_LIMITS.steps + 1) { issue(`workflows.${node.id}`, 'A run supports at most 50 action steps.'); break; }
        }
      } else if (ins.length !== 1) issue(`workflows.${node.id}`, 'Each action requires exactly one predecessor.');
    }
    for (const node of project.workflows.nodes) if (!visited.has(node.id)) issue(`workflows.${node.id}`, 'Action is orphaned or part of an unreachable cycle.');

    const checkReference = (value: string, path: string, stepId?: string, whole = false) => {
      if (draft) return;
      const matcher = /\{\{([^{}]+)\}\}/g;
      const matches = [...value.matchAll(matcher)];
      if (whole && (matches.length !== 1 || matches[0][0] !== value)) issue(path, 'Binding must be one complete reference.');
      if (value.replace(matcher, '').includes('{{') || value.replace(matcher, '').includes('}}')) issue(path, 'Malformed binding.');
      for (const match of matches) {
        const ref = match[1]; const parts = ref.split('.');
        if (parts.some((part) => dangerous.has(part))) { issue(path, 'Reserved binding path.'); continue; }
        if (parts[0] === 'state' && parts.length === 2 && names.has(parts[1])) continue;
        if (parts[0] === 'wallet' && parts.length === 2 && ['address', 'chainId'].includes(parts[1])) continue;
        if (parts[0] === 'inputs' && parts.length === 3 && parts[2] === 'value' && blockMap.get(parts[1])?.type === 'Input') continue;
        if (parts[0] === 'steps' && parts.length === 3 && stepId && predecessors.get(stepId)?.has(parts[1])) {
          const source = nodeMap.get(parts[1]);
          if ((source?.type === 'contract_read' && parts[2] === 'output') || (source?.type === 'contract_write' && parts[2] === 'output')) continue;
        }
        issue(path, `Unknown, unsupported, or forward reference: ${ref}`);
      }
    };
    const checkAction = (config: ContractActionConfig, path: string, kind: 'read' | 'write', stepId?: string) => {
      const contract = project.contracts.find((c) => c.id === config.contractId);
      const fn = functions.get(config.contractId)?.get(config.functionSignature);
      if (!contract || !fn || !contract.exposedFunctions.includes(config.functionSignature)) issue(path, 'Select a registered contract and an explicitly exposed full function signature.');
      else {
        const read = ['view', 'pure'].includes(fn.stateMutability);
        if ((kind === 'read') !== read) issue(path, `Selected function does not support a ${kind} action.`);
        if (fn.inputs.length !== config.args.length) issue(path, `Expected ${fn.inputs.length} arguments.`);
        if (config.value && config.value !== '0' && fn.stateMutability !== 'payable') issue(path, 'Native value is only supported by payable functions.');
        config.args.forEach((arg, index) => {
          const type = fn.inputs[index]?.type ?? '';
          if (arg.decimals !== undefined && !/^u?int\d+$/.test(type)) issue(path, 'Decimals conversion is supported only for integer parameters.');
          if (!validConstant(arg.value, type, arg.decimals)) issue(path, `Argument ${index + 1} is not a valid ${type} value.`);
        });
        if (config.value !== undefined && !validConstant(config.value, 'uint256', 18)) issue(path, 'Native value must be a nonnegative decimal amount with at most 18 decimal places.');
      }
      for (const arg of config.args) checkReference(arg.value, path, stepId);
      if (config.value !== undefined) checkReference(config.value, path, stepId);
      if (config.outputVariable) {
        const variable = project.variables.find((entry) => entry.name === config.outputVariable);
        if (!variable) issue(path, 'Output variable is not declared.');
        else if (kind === 'write' && variable.type !== 'string') issue(path, 'Contract write output variable must be a string to store the transaction hash.');
      }
    };
    semantic = false;
    for (const node of blocks) {
      const path = `uiTree.${node.id}`;
      for (const [key, value] of Object.entries(node.props)) {
        if (!properties[node.type].includes(key)) { issue(path, `Unsupported property: ${key}`); continue; }
        if (key === 'args') { if (!Array.isArray(value)) issue(path, 'Arguments must be an array of { value, decimals? } objects.'); }
        else if (key === 'level') { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) issue(path, 'Heading level must be 1–6.'); }
        else if (key === 'decimals') { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) issue(path, 'Decimals must be an integer from 0 to 255.'); }
        else if (typeof value !== 'string') issue(path, `Property ${key} must be text.`);
        if (key === 'inputType' && !['text', 'number', 'email'].includes(String(value))) issue(path, 'Unsupported input type.');
        if (key === 'variant' && !['primary', 'secondary', 'outline', 'ghost'].includes(String(value))) issue(path, 'Unsupported button variant.');
        if (typeof value === 'string' && !['contractId', 'functionSignature', 'inputType', 'variant'].includes(key)) checkReference(value, path);
      }
      for (const [key, value] of Object.entries(node.styles)) if (!Object.hasOwn(styles, key) || !styles[key](value)) issue(path, `Unsupported or unsafe style: ${key}`);
      for (const [key, value] of Object.entries(node.bindings ?? {})) {
        if (!bindingProperties[node.type].includes(key)) issue(path, `Unsupported binding property: ${key}`);
        checkReference(value, path, undefined, true);
      }
      if (!draft && (node.type === 'ContractRead' || node.type === 'ContractWrite')) {
        const config = action.safeParse({ contractId: node.props.contractId, functionSignature: node.props.functionSignature, args: node.props.args, value: node.props.value, outputVariable: node.props.outputVariable });
        if (!config.success) issue(path, 'Configure the contract, function signature, and arguments before preview or export.');
        else checkAction(config.data, path, node.type === 'ContractRead' ? 'read' : 'write');
      }
    }
    if (!draft) for (const node of project.workflows.nodes) {
      const path = `workflows.${node.id}`;
      if (node.type === 'contract_read' || node.type === 'contract_write') checkAction(node.config, path, node.type === 'contract_read' ? 'read' : 'write', node.id);
      if (node.type === 'ui_feedback') {
        checkReference(node.config.message, path, node.id);
        if (node.config.value !== undefined) checkReference(node.config.value, path, node.id);
        if (node.config.variable && !names.has(node.config.variable)) issue(path, 'Feedback variable is not declared.');
        if (node.config.variable && node.config.value === undefined) issue(path, 'A variable update requires a value.');
      }
    }
    // Drafts keep semantic reference/graph errors for repair; never weaken JSON/style boundaries.
    return issues.length ? { success: false, issues } : { success: true, project, issues: [] };
  } catch { return { success: false, issues: [{ path: '', message: 'Invalid or unsupported project data.' }] }; }
}

export function validateProject(input: unknown): ValidationResult { return validate(input, false); }
/** Local authoring permits unconfigured contract blocks; import/runtime/export must use validateProject. */
export function validateProjectDraft(input: unknown): ValidationResult { return validate(input, true); }
export function parseProjectJson(text: string): ValidationResult {
  if (text.length > PROJECT_LIMITS.bytes || new TextEncoder().encode(text).length > PROJECT_LIMITS.bytes) return { success: false, issues: [{ path: '', message: 'Project exceeds the 1 MiB limit.' }] };
  try { return validateProject(JSON.parse(text)); } catch { return { success: false, issues: [{ path: '', message: 'Project is not valid JSON.' }] }; }
}
