// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAbi, type TransactionReceipt } from 'viem';
import { createBlock, createProject, validateProject } from '../../lib/schema';
import type { ContractConfig, ImpactorProjectSchema } from '../../lib/schema/types';
import { ActionError } from '../../lib/engine/workflow';
import { readContract, registerContract } from '../../lib/web3/contracts';
import { checkReceipt, readJournal, writeContract } from '../../lib/web3/transactions';
import { deployTemplate } from '../../lib/web3/templates';
import { RuntimeApp } from './RuntimeApp';
import { ContractManager } from './ContractManager';

vi.mock('wagmi', () => ({ useConfig: () => ({}), useAccount: () => ({ address: '0x0000000000000000000000000000000000000001', chainId: 43113 }) }));
vi.mock('wagmi/actions', () => ({ getWalletClient: vi.fn(async () => ({})) }));
vi.mock('../providers/Web3Providers', () => ({ Web3Providers: ({ children }: { children: ReactNode }) => children }));
vi.mock('./WalletControls', () => ({ WalletControls: () => null }));
vi.mock('./TransactionReview', () => ({ TransactionReviewDialog: () => null, useTransactionReview: () => ({ intent: null, review: vi.fn(), answer: vi.fn() }) }));
vi.mock('../../lib/web3/contracts', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/web3/contracts')>(), readContract: vi.fn(), registerContract: vi.fn() }));
vi.mock('../../lib/web3/transactions', () => ({ writeContract: vi.fn(), checkReceipt: vi.fn(), readJournal: vi.fn(() => []), journal: vi.fn() }));
vi.mock('../../lib/web3/templates', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/web3/templates')>(), deployTemplate: vi.fn() }));

const hash = `0x${'ab'.repeat(32)}` as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(): ImpactorProjectSchema {
  const project = createProject('Runtime regression', 'blank');
  project.variables = [{ id: 'v', name: 'recipient', type: 'string', initialValue: 'original' }];
  project.contracts = [{ id: 'token', name: 'Token', chainId: 43113, address: '0x0000000000000000000000000000000000000001', abi: parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']), exposedFunctions: ['balanceOf(address)', 'transfer(address,uint256)'] }];
  const input = createBlock('Input'); input.id = 'recipient-input'; input.props = { label: 'Recipient', value: 'default' }; input.bindings = { value: '{{state.recipient}}' };
  const text = createBlock('Text'); text.props = { text: 'Current: {{state.recipient}}' };
  const read = createBlock('ContractRead'); read.id = 'balance'; read.props = { label: 'Balance', contractId: 'token', functionSignature: 'balanceOf(address)', args: [{ value: '{{wallet.address}}' }] };
  const write = createBlock('ContractWrite'); write.id = 'transfer'; write.props = { label: 'Transfer', contractId: 'token', functionSignature: 'transfer(address,uint256)', args: [{ value: '{{wallet.address}}' }, { value: '1' }] };
  const button = createBlock('Button'); button.id = 'update'; button.props = { label: 'Set state' };
  project.uiTree.children = [input, text, read, write, button];
  project.workflows = { nodes: [
    { id: 'trigger', type: 'ui_trigger', label: 'Start', position: { x: 0, y: 0 }, config: { blockId: button.id, event: 'onClick' } },
    { id: 'feedback', type: 'ui_feedback', label: 'Update', position: { x: 0, y: 1 }, config: { message: 'Updated', variable: 'recipient', value: 'changed' } },
  ], edges: [{ id: 'edge', source: 'trigger', target: 'feedback' }] };
  expect(validateProject(project).success).toBe(true);
  return project;
}
function successfulReceipt(): TransactionReceipt {
  return { status: 'success', transactionHash: hash, contractAddress: '0x0000000000000000000000000000000000000002', blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 1n, effectiveGasPrice: 1n, from: '0x0000000000000000000000000000000000000001', gasUsed: 1n, logs: [], logsBloom: '0x', to: null, transactionIndex: 0, type: 'eip1559' };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readJournal).mockReturnValue([]); vi.mocked(readContract).mockResolvedValue(10n); vi.mocked(writeContract).mockResolvedValue(hash); vi.mocked(checkReceipt).mockResolvedValue(successfulReceipt()); });
afterEach(cleanup);

describe('runtime project sessions', () => {
  it('resets edited inputs, mutable state and loaded outputs on a new idle revision', async () => {
    const project = fixture(); const view = render(<RuntimeApp project={project} />);
    expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('original');
    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set state' }));
    await screen.findByText('Current: changed');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh read' }));
    await screen.findByText('10');
    const next = structuredClone(project); next.variables[0].initialValue = 'new default';
    view.rerender(<RuntimeApp project={next} />);
    await waitFor(() => expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('new default'));
    expect(screen.getByText('Current: new default')).toBeTruthy();
    expect(screen.getByText('Not loaded')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Run status' })).toBeNull();
  });
  it('refreshes loaded reads after confirmation without loading untouched reads', async () => {
    const project = fixture(); const extra = structuredClone(project.uiTree.children![2]); extra.id = 'untouched'; extra.props.label = 'Untouched'; project.uiTree.children!.push(extra);
    vi.mocked(readContract).mockResolvedValueOnce(10n).mockResolvedValueOnce(9n);
    render(<RuntimeApp project={project} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh read' })[0]); await screen.findByText('10');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' })); await screen.findByText('9');
    expect(readContract).toHaveBeenCalledTimes(2); expect(writeContract).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not loaded')).toBeTruthy();
    expect(vi.mocked(readContract).mock.calls[1][3].wallet.address).toBe('0x0000000000000000000000000000000000000001');
  });
  it('does not turn a confirmed write into a failed transaction when read refresh fails', async () => {
    vi.mocked(readContract).mockResolvedValueOnce(10n).mockRejectedValueOnce(new Error('RPC unavailable'));
    render(<RuntimeApp project={fixture()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh read' })); await screen.findByText('10');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    await screen.findByText(/previously loaded read could not refresh/);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Run status' }).textContent).toContain('succeeded'));
  });
  it.each(['awaiting_consent', 'awaiting_wallet', 'confirming'] as const)('keeps a %s run across project switches and checks its frozen original network', async status => {
    const project = fixture(); const originalNetwork = structuredClone(project.network); const pending = deferred<`0x${string}`>();
    vi.mocked(writeContract).mockImplementation(async (_network, _contract, _action, _values, _wallet, _review, progress) => { progress(status, hash); return pending.promise; });
    const view = render(<RuntimeApp project={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' })); await screen.findByText(status.replaceAll('_', ' '));
    const next = fixture(); next.id = 'different'; next.network.rpcUrl = 'https://other-rpc.example'; next.variables[0].initialValue = 'next project';
    view.rerender(<RuntimeApp project={next} />);
    expect(screen.getByText('Run in progress')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Transfer' }) as HTMLButtonElement).disabled).toBe(true);
    // Also mutate the original prop to ensure monitoring uses a deep snapshot, not a borrowed object.
    project.network.rpcUrl = 'https://mutated-rpc.example';
    await act(async () => pending.reject(new ActionError('Still unknown', 'unknown')));
    await screen.findByText('Transaction status unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Check status (read only)' }));
    await waitFor(() => expect(checkReceipt).toHaveBeenCalledWith(originalNetwork, hash));
    await waitFor(() => expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('next project'));
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it('refreshes loaded reads on read-only reconciliation without resubmitting a write', async () => {
    vi.mocked(readContract).mockResolvedValueOnce(10n).mockResolvedValueOnce(9n);
    vi.mocked(writeContract).mockImplementation(async (_network, _contract, _action, _values, _wallet, _review, progress) => { progress('confirming', hash); throw new ActionError('Still unknown', 'unknown'); });
    render(<RuntimeApp project={fixture()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh read' })); await screen.findByText('10');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' })); await screen.findByText('Transaction status unknown');
    expect(readContract).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check status (read only)' })); await screen.findByText('9');
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it('resolves complete input references including hyphenated IDs without mutating authored defaults', () => {
    const project = fixture();
    const input = project.uiTree.children![0]; input.bindings = { value: '{{inputs.source-input.value}}' };
    const source = createBlock('Input'); source.id = 'source-input'; source.props = { label: 'Source', value: 'seed' }; project.uiTree.children!.push(source);
    render(<RuntimeApp project={project} />);
    expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('seed');
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'edited source' } });
    expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('edited source');
    expect(source.props.value).toBe('seed');
  });
  it.each(['{{state.recipient.length}}', '{{state.__proto__}}', 'prefix {{state.recipient}}', '{{state.recipient'])('fails closed for invalid input binding %s', value => {
    const project = fixture(); project.uiTree.children![0].bindings = { value };
    render(<RuntimeApp project={project} />);
    expect(screen.getByRole('alert').textContent).toContain('Complete project configuration');
    expect(screen.queryByLabelText('Recipient')).toBeNull();
    expect(writeContract).not.toHaveBeenCalled();
  });
});

describe('deployment project identity', () => {
  function beginDeployment(project: ImpactorProjectSchema) {
    const onChange = vi.fn(); const view = render(<ContractManager project={project} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deploy template' }));
    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Original token' } });
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'ORG' } });
    fireEvent.change(screen.getByLabelText('Initial supply recipient'), { target: { value: project.contracts[0].address } });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate and review deployment' }));
    return { ...view, onChange };
  }
  it('blocks original-template recovery for a persistently marked different-intent hash', async () => {
    const project = fixture();
    vi.mocked(deployTemplate).mockImplementation(async (_network, _form, _wallet, _review, progress) => { progress('confirming', hash); throw new ActionError('Still unknown', 'unknown'); });
    const view = beginDeployment(project); await screen.findByRole('button', { name: 'Check deployment status (no resubmission)' });
    vi.mocked(readJournal).mockReturnValue([{ hash, chainId: 43113, kind: 'deployment', status: 'success', timestamp: Date.now(), intent: 'different' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Check deployment status (no resubmission)' }));
    await screen.findByText(/Original-template recovery is disabled/);
    expect(checkReceipt).not.toHaveBeenCalled(); expect(registerContract).not.toHaveBeenCalled(); expect(view.onChange).not.toHaveBeenCalled();
  });
  it('keeps post-receipt code-verification uncertainty non-retryable with status recovery available', async () => {
    const project = fixture();
    vi.mocked(deployTemplate).mockImplementation(async (_network, _form, _wallet, _review, progress) => { progress('submitted', hash); throw new ActionError('Deployment receipt succeeded but code verification is unavailable. Do not redeploy.', 'unknown'); });
    const view = beginDeployment(project); await screen.findByRole('button', { name: 'Check deployment status (no resubmission)' });
    expect((screen.getByRole('button', { name: 'Simulate and review deployment' }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.onChange).not.toHaveBeenCalled(); expect(deployTemplate).toHaveBeenCalledTimes(1);
  });
  it('preserves deployment success when a confirmed contract cannot be added locally', async () => {
    const project = fixture();
    vi.mocked(deployTemplate).mockImplementation(async (_network, _form, _wallet, _review, progress) => { progress('submitted', hash); return project.contracts[0]; });
    const view = beginDeployment(project);
    await screen.findByText(/local project update failed/);
    expect(screen.getByText('Deployment transaction · succeeded')).toBeTruthy();
    expect(view.onChange).not.toHaveBeenCalled(); expect(deployTemplate).toHaveBeenCalledTimes(1);
  });
  it('never appends a pending deployment to another project after props change', async () => {
    const project = fixture(); const contract: ContractConfig = { ...project.contracts[0], id: 'deployed', address: '0x0000000000000000000000000000000000000002' }; const pending = deferred<ContractConfig>();
    vi.mocked(deployTemplate).mockReturnValue(pending.promise);
    const view = beginDeployment(project); await waitFor(() => expect(deployTemplate).toHaveBeenCalledTimes(1));
    const next = fixture(); next.id = 'other-project'; const nextChange = vi.fn();
    view.rerender(<ContractManager project={next} onChange={nextChange} />);
    await act(async () => pending.resolve(contract));
    await screen.findByText(/editor project changed/);
    expect(view.onChange).not.toHaveBeenCalled(); expect(nextChange).not.toHaveBeenCalled();
  });
  it('reconciles an unknown deployment on its original network without registering into the new project', async () => {
    const project = fixture(); const originalNetwork = structuredClone(project.network);
    vi.mocked(deployTemplate).mockImplementation(async (_network, _form, _wallet, _review, progress) => { progress('confirming', hash); throw new ActionError('Still unknown', 'unknown'); });
    vi.mocked(registerContract).mockResolvedValue({ ...project.contracts[0], id: 'deployed', address: '0x0000000000000000000000000000000000000002' });
    const view = beginDeployment(project); await screen.findByRole('button', { name: 'Check deployment status (no resubmission)' });
    const next = fixture(); next.id = 'other-project'; next.network.rpcUrl = 'https://other-rpc.example'; const nextChange = vi.fn();
    view.rerender(<ContractManager project={next} onChange={nextChange} />);
    project.network.rpcUrl = 'https://mutated-rpc.example';
    fireEvent.click(screen.getByRole('button', { name: 'Check deployment status (no resubmission)' }));
    await screen.findByText(/editor project changed/);
    expect(checkReceipt).toHaveBeenCalledWith(originalNetwork, hash);
    expect(registerContract).toHaveBeenCalledWith(originalNetwork, '0x0000000000000000000000000000000000000002', expect.any(String), 'Original token');
    expect(nextChange).not.toHaveBeenCalled(); expect(view.onChange).not.toHaveBeenCalled(); expect(deployTemplate).toHaveBeenCalledTimes(1);
  });
});
