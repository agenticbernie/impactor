import { describe, expect, it, vi } from 'vitest';
import { parseAbi } from 'viem';
import { createBlock, createProject, validateProject } from '../schema';
import { WorkflowEngine, ActionError, type ExecutionPorts } from './workflow';
import type { BindingContext } from './bindings';

const hash = `0x${'ab'.repeat(32)}` as const;
function fixture() {
  const project = createProject('Runtime test', 'blank'); const button = createBlock('Button'); project.uiTree.children = [button];
  project.variables = [{ id: 'balance', name: 'balance', type: 'string', initialValue: '0' }];
  project.contracts = [{ id: 'token', name: 'Token', chainId: 43113, address: '0x0000000000000000000000000000000000000001', abi: parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']), exposedFunctions: ['balanceOf(address)', 'transfer(address,uint256)'] }];
  project.workflows = { nodes: [
    { id: 'trigger', type: 'ui_trigger', label: 'Start', position: { x: 0, y: 0 }, config: { blockId: button.id, event: 'onClick' } },
    { id: 'read', type: 'contract_read', label: 'Balance', position: { x: 0, y: 100 }, config: { contractId: 'token', functionSignature: 'balanceOf(address)', args: [{ value: '{{wallet.address}}' }], outputVariable: 'balance' } },
    { id: 'write', type: 'contract_write', label: 'Transfer', position: { x: 0, y: 200 }, config: { contractId: 'token', functionSignature: 'transfer(address,uint256)', args: [{ value: '{{wallet.address}}' }, { value: '{{steps.read.output}}' }] } },
    { id: 'feedback', type: 'ui_feedback', label: 'Done', position: { x: 0, y: 300 }, config: { message: 'Transaction confirmed' } },
  ], edges: [{ id: 'a', source: 'trigger', target: 'read' }, { id: 'b', source: 'read', target: 'write' }, { id: 'c', source: 'write', target: 'feedback' }] };
  expect(validateProject(project)).toMatchObject({ success: true });
  const context: BindingContext = { state: { balance: '0' }, wallet: { address: '0x0000000000000000000000000000000000000001', chainId: 43113 }, inputs: {}, steps: {} };
  const ports: ExecutionPorts = { read: vi.fn(async () => 25n), write: vi.fn(async () => hash), feedback: vi.fn(), updateState: vi.fn() };
  return { project, button, context, ports };
}
describe('sequential workflow engine', () => {
  it('executes read → write → feedback with prior output and immutable authored state', async () => {
    const { project, button, context, ports } = fixture();
    ports.write = vi.fn(async (_action, values) => { expect(values.steps.read.output).toBe(25n); return hash; });
    const result = await new WorkflowEngine().execute(project, button.id, context, ports);
    expect(result.steps.every(step => step.status === 'succeeded')).toBe(true);
    expect(ports.feedback).toHaveBeenCalledWith('Transaction confirmed');
    expect(project.variables[0].initialValue).toBe('0'); expect(context.state.balance).toBe('0');
  });
  it('rejects double clicks and freezes inputs before the first await', async () => {
    const { project, button, context, ports } = fixture(); let finish!: (value: bigint) => void;
    ports.read = vi.fn(() => new Promise<bigint>(resolve => { finish = resolve; }));
    const engine = new WorkflowEngine(); const first = engine.execute(project, button.id, context, ports);
    await expect(engine.execute(project, button.id, context, ports)).rejects.toThrow(/active/);
    context.wallet.address = 'changed'; finish(1n); await first;
    expect(ports.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ports.write).mock.calls[0][1].wallet.address).not.toBe('changed');
  });
  it.each(['rejected', 'reverted', 'cancelled', 'unknown'] as const)('stops downstream after %s without replay', async status => {
    const { project, button, context, ports } = fixture(); const engine = new WorkflowEngine();
    ports.write = vi.fn(async (_action, _values, progress) => { progress('submitted', hash); throw new ActionError('Stopped', status); });
    const run = await engine.execute(project, button.id, context, ports);
    expect(run.steps[2].status).toBe(status); expect(run.steps[3].status).toBe('cancelled'); expect(ports.feedback).not.toHaveBeenCalled();
    if (status === 'unknown') {
      await expect(engine.execute(project, button.id, context, ports)).rejects.toThrow(/unresolved/);
      engine.reconcile(hash, 'success'); expect(engine.busy).toBe(false); expect(ports.feedback).not.toHaveBeenCalled(); expect(ports.write).toHaveBeenCalledTimes(1);
    }
  });
  it('cancels actions not yet started after a pending read', async () => {
    const { project, button, context, ports } = fixture(); let finish!: (value: bigint) => void;
    ports.read = vi.fn(() => new Promise<bigint>(resolve => { finish = resolve; }));
    const engine = new WorkflowEngine(); const pending = engine.execute(project, button.id, context, ports); engine.cancel(); finish(2n);
    const result = await pending; expect(result.cancelled).toBe(true); expect(ports.write).not.toHaveBeenCalled();
  });
  it.each(['number', 'boolean'] as const)('rejects a %s write output variable before any chain action', async type => {
    const { project, button, context, ports } = fixture();
    project.variables.push({ id: 'tx', name: 'transaction', type, initialValue: type === 'number' ? 0 : false });
    const write = project.workflows.nodes.find(node => node.id === 'write');
    if (write?.type !== 'contract_write') throw new Error('Missing write fixture');
    write.config.outputVariable = 'transaction';
    await expect(new WorkflowEngine().execute(project, button.id, context, ports)).rejects.toThrow(/string/);
    expect(ports.read).not.toHaveBeenCalled(); expect(ports.write).not.toHaveBeenCalled();
  });
  it('validates direct write output types before wallet submission', async () => {
    const { project, button, context, ports } = fixture();
    project.variables.push({ id: 'tx', name: 'transaction', type: 'boolean', initialValue: false });
    const write = project.workflows.nodes.find(node => node.id === 'write');
    if (write?.type !== 'contract_write') throw new Error('Missing write fixture');
    await expect(new WorkflowEngine().execute(project, button.id, context, ports, { type: 'contract_write', config: { ...write.config, outputVariable: 'transaction' } })).rejects.toThrow(/string/);
    expect(ports.write).not.toHaveBeenCalled();
  });
  it('preserves confirmed write success/hash when local state notification throws', async () => {
    const { project, button, context, ports } = fixture();
    ports.updateState = vi.fn(() => { if (vi.mocked(ports.write).mock.calls.length) throw new Error('Local UI failure'); });
    const result = await new WorkflowEngine().execute(project, button.id, context, ports);
    expect(result.steps[2]).toMatchObject({ status: 'succeeded', chainStatus: 'success', txHash: hash, error: expect.stringContaining('Do not resubmit') });
    expect(result.steps[3].status).toBe('cancelled');
    expect(ports.write).toHaveBeenCalledTimes(1); expect(ports.feedback).not.toHaveBeenCalled();
  });
  it('records a returned write hash even if the port omitted progress notifications', async () => {
    const { project, button, context, ports } = fixture();
    const result = await new WorkflowEngine().execute(project, button.id, context, ports);
    expect(result.steps[2]).toMatchObject({ chainStatus: 'success', txHash: hash, status: 'succeeded' });
  });
  it('rejects invalid graphs before invoking chain ports', async () => {
    const { project, button, context, ports } = fixture(); project.workflows.edges.push({ id: 'cycle', source: 'feedback', target: 'read' });
    await expect(new WorkflowEngine().execute(project, button.id, context, ports)).rejects.toThrow(); expect(ports.read).not.toHaveBeenCalled();
  });
});
