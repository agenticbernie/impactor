import { describe, expect, it } from 'vitest';
import { parseAbi } from 'viem';
import { canonicalizeProject, createBlock, createProject, flattenBlocks, parseProjectJson, validateProject, validateProjectDraft } from './index';
import type { ImpactorProjectSchema, WorkflowNode } from './types';

function fixture(): ImpactorProjectSchema {
  const project = createProject('Test', 'blank');
  const button = createBlock('Button'); button.id = 'button';
  project.uiTree.children = [button];
  project.contracts = [{ id: 'token', name: 'Token', chainId: 43113, address: '0x0000000000000000000000000000000000000001', abi: parseAbi(['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']), exposedFunctions: ['balanceOf(address)', 'transfer(address,uint256)'] }];
  const common = { label: 'Step', position: { x: 0, y: 0 } };
  project.workflows.nodes = [
    { ...common, id: 'trigger', type: 'ui_trigger', config: { blockId: 'button', event: 'onClick' } },
    { ...common, id: 'read', type: 'contract_read', config: { contractId: 'token', functionSignature: 'balanceOf(address)', args: [{ value: '{{wallet.address}}' }] } },
    { ...common, id: 'feedback', type: 'ui_feedback', config: { message: 'Balance: {{steps.read.output}}' } },
  ];
  project.workflows.edges = [{ id: 'a', source: 'trigger', target: 'read' }, { id: 'b', source: 'read', target: 'feedback' }];
  return project;
}
describe('project validation and serialization', () => {
  it('creates a valid starter without fictional deployed contracts', () => {
    const project = createProject(); expect(project.contracts).toEqual([]); expect(validateProject(project).success).toBe(true);
    expect(flattenBlocks(project.uiTree).some((block) => block.type === 'Input')).toBe(true);
  });
  it('canonicalizes keys but preserves array order and round-trips', () => {
    const project = fixture(); const text = canonicalizeProject(project); const parsed = parseProjectJson(text);
    expect(parsed.success).toBe(true); if (parsed.success) expect(canonicalizeProject(parsed.project)).toBe(text);
    expect(canonicalizeProject({ ...project, name: project.name })).toBe(text);
    expect(JSON.parse(text).workflows.nodes.map((n: WorkflowNode) => n.id)).toEqual(['trigger', 'read', 'feedback']);
  });
  it('orders dependency checks by edges rather than nodes array order', () => {
    const project = fixture(); project.workflows.nodes.reverse(); expect(validateProject(project).success).toBe(true);
  });
  it.each([
    ['future version', (p: ImpactorProjectSchema) => { (p as unknown as { schemaVersion: number }).schemaVersion = 2; }],
    ['duplicate block', (p: ImpactorProjectSchema) => { p.uiTree.children!.push(structuredClone(p.uiTree.children![0])); }],
    ['unknown property', (p: ImpactorProjectSchema) => { p.uiTree.props.dangerouslySetInnerHTML = 'bad'; }],
    ['unsafe CSS', (p: ImpactorProjectSchema) => { p.uiTree.styles.backgroundColor = 'url(javascript:alert(1))'; }],
    ['unsafe URL', (p: ImpactorProjectSchema) => { p.network.rpcUrl = 'javascript:alert(1)'; }],
    ['network mismatch', (p: ImpactorProjectSchema) => { p.contracts[0].chainId = 43114; }],
    ['function name without signature', (p: ImpactorProjectSchema) => { p.contracts[0].exposedFunctions = ['balanceOf']; }],
    ['orphan', (p: ImpactorProjectSchema) => { p.workflows.edges = []; }],
    ['branch', (p: ImpactorProjectSchema) => { p.workflows.edges.push({ id: 'c', source: 'trigger', target: 'feedback' }); }],
    ['cycle', (p: ImpactorProjectSchema) => { p.workflows.edges.push({ id: 'c', source: 'feedback', target: 'read' }); }],
    ['prototype reference', (p: ImpactorProjectSchema) => { p.uiTree.children![0].bindings = { label: '{{state.__proto__}}' }; }],
    ['unknown input', (p: ImpactorProjectSchema) => { p.uiTree.children![0].bindings = { label: '{{inputs.missing.value}}' }; }],
    ['forward reference', (p: ImpactorProjectSchema) => { const read = p.workflows.nodes[1]; if (read.type === 'contract_read') read.config.args = [{ value: '{{steps.feedback.output}}' }]; }],
    ['string argument array', (p: ImpactorProjectSchema) => { p.uiTree.children!.push({ ...createBlock('ContractRead'), props: { contractId: 'token', functionSignature: 'balanceOf(address)', args: ['{{wallet.address}}'] } }); }],
    ['nonfinite number', (p: ImpactorProjectSchema) => { p.workflows.nodes[0].position.x = Infinity; }],
  ])('rejects %s', (_name, mutate) => { const project = fixture(); mutate(project); expect(validateProject(project).success).toBe(false); });
  it('preserves and validates direct payable value and output variables', () => {
    const project = fixture();
    project.contracts[0].abi = [...project.contracts[0].abi, ...parseAbi(['function deposit() payable'])];
    project.contracts[0].exposedFunctions.push('deposit()');
    project.variables = [{ id: 'hash', name: 'hash', type: 'string', initialValue: '' }, { id: 'balance', name: 'balance', type: 'string', initialValue: '' }];
    const write = createBlock('ContractWrite');
    write.props = { contractId: 'token', functionSignature: 'deposit()', args: [], value: '0.25', outputVariable: 'hash' };
    const read = createBlock('ContractRead');
    read.props = { contractId: 'token', functionSignature: 'balanceOf(address)', args: [{ value: '{{wallet.address}}' }], outputVariable: 'balance' };
    project.uiTree.children!.push(write, read);
    const result = validateProject(project);
    expect(result.success).toBe(true);
    if (result.success) expect(flattenBlocks(result.project.uiTree).find((block) => block.id === write.id)?.props).toEqual(write.props);
    write.props.value = '-1'; expect(validateProject(project).issues.some((issue) => issue.message.includes('Native value'))).toBe(true);
    write.props.value = '0.25';
    write.props.functionSignature = 'transfer(address,uint256)'; write.props.args = [{ value: '{{wallet.address}}' }, { value: '1' }];
    expect(validateProject(project).issues.some((issue) => issue.message.includes('only supported by payable'))).toBe(true);
    write.props.value = '0'; read.props.outputVariable = 'missing';
    expect(validateProject(project).issues.some((issue) => issue.message.includes('not declared'))).toBe(true);
  });
  it.each(['direct', 'workflow'] as const)('requires a declared string output variable for %s writes', (surface) => {
    const project = fixture();
    project.variables = [{ id: 'result', name: 'result', type: 'number', initialValue: 0 }];
    const config = { contractId: 'token', functionSignature: 'transfer(address,uint256)', args: [{ value: '{{wallet.address}}' }, { value: '1' }], outputVariable: 'result' };
    if (surface === 'direct') project.uiTree.children!.push({ ...createBlock('ContractWrite'), props: config });
    else project.workflows.nodes[1] = { id: 'read', type: 'contract_write', label: 'Write', position: { x: 0, y: 0 }, config };
    expect(validateProject(project).issues.some((issue) => issue.message.includes('must be a string'))).toBe(true);
    project.variables[0] = { id: 'result', name: 'result', type: 'string', initialValue: '' };
    expect(validateProject(project).success).toBe(true);
    project.variables = [];
    expect(validateProject(project).issues.some((issue) => issue.message.includes('not declared'))).toBe(true);
  });
  it.each(['value', 'outputVariable'])('rejects non-string direct action %s', (key) => {
    const project = fixture();
    const block = createBlock('ContractWrite');
    block.props = { contractId: 'token', functionSignature: 'transfer(address,uint256)', args: [{ value: '{{wallet.address}}' }, { value: '1' }], [key]: 1 };
    project.uiTree.children!.push(block);
    expect(validateProject(project).success).toBe(false);
    expect(validateProjectDraft(project).success).toBe(false);
  });
  it('rejects arrays/tuples exposed for interaction but retains inert ABI metadata', () => {
    const project = fixture(); project.contracts[0].abi = parseAbi(['function batch(address[] owners) view returns (uint256)']);
    project.contracts[0].exposedFunctions = ['batch(address[])']; expect(validateProject(project).success).toBe(false);
  });
  it('keeps unconfigured blocks and workflow drafts locally but blocks runtime/export', () => {
    const project = createProject(); project.uiTree.children!.push(createBlock('ContractRead'));
    project.workflows.nodes.push({ id: 'draft-trigger', label: 'Draft', type: 'ui_trigger', position: { x: 0, y: 0 }, config: { blockId: '', event: 'onClick' } });
    expect(validateProjectDraft(project).success).toBe(true); expect(validateProject(project).success).toBe(false);
  });
  it('rejects byte limits, deep trees, cycles and malicious keys without throwing', () => {
    expect(parseProjectJson(' '.repeat(1024 * 1024 + 1)).success).toBe(false);
    expect(parseProjectJson('{"__proto__":{}}').success).toBe(false);
    expect(parseProjectJson('{').success).toBe(false);
    const project = createProject('Deep', 'blank'); let block = project.uiTree;
    for (let i = 0; i < 20; i++) { const child = createBlock('Container'); block.children = [child]; block = child; }
    expect(validateProject(project).success).toBe(false);
    block.children = [project.uiTree]; expect(validateProject(project).success).toBe(false);
    expect(() => canonicalizeProject(project)).toThrow();
  });
  it('rejects accessors without invoking them', () => {
    const project = createProject(); let invoked = false;
    Object.defineProperty(project, 'name', { get() { invoked = true; return 'Unsafe'; }, enumerable: true });
    expect(validateProject(project).success).toBe(false); expect(invoked).toBe(false);
  });
  it('rejects too many blocks and actions', () => {
    const project = createProject('Cap', 'blank'); project.uiTree.children = Array.from({ length: 500 }, () => createBlock('Text'));
    expect(validateProject(project).success).toBe(false);
    const chain = fixture(); let previous = 'feedback';
    for (let i = 0; i < 50; i++) { const id = `step${i}`; chain.workflows.nodes.push({ id, type: 'ui_feedback', label: id, position: { x: 0, y: 0 }, config: { message: 'Done' } }); chain.workflows.edges.push({ id, source: previous, target: id }); previous = id; }
    expect(validateProject(chain).success).toBe(false);
  });
});
