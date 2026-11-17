// @vitest-environment jsdom
import React, { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAbi } from 'viem';
import { createProject } from '../../lib/schema';
import type { ContractConfig } from '../../lib/schema/types';
import { deployTemplate } from '../../lib/web3/templates';
import { Web3Providers } from '../providers/Web3Providers';
import { ContractManager } from './ContractManager';
import { RuntimeApp } from './RuntimeApp';

// Keep real wagmi hooks/providers: mocked hooks cannot detect competing wallet stores.
vi.mock('../../lib/web3/templates', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/web3/templates')>(),
  deployTemplate: vi.fn(),
}));

const account = '0x0000000000000000000000000000000000000001';
const hash = `0x${'ab'.repeat(32)}` as const;
const contract: ContractConfig = {
  id: 'confirmed-token', name: 'Confirmed token', chainId: 43113,
  address: '0x0000000000000000000000000000000000000002',
  abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
  exposedFunctions: ['balanceOf(address)'],
};
const request = vi.fn(async ({ method }: { method: string }) => {
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
  if (method === 'eth_chainId') return '0xa869';
  if (method === 'wallet_requestPermissions') return [];
  throw new Error(`Unexpected wallet request: ${method}`);
});

function Workspace() {
  const [project, setProject] = useState(() => createProject('Wallet regression'));
  return <Web3Providers>
    <RuntimeApp project={project} />
    <ContractManager project={project} onChange={setProject} />
  </Web3Providers>;
}

beforeEach(() => {
  localStorage.clear();
  request.mockClear();
  vi.stubGlobal('ethereum', { request, on() {}, removeListener() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })));
  vi.mocked(deployTemplate).mockImplementation(async (_network, _input, _wallet, _review, progress) => {
    progress('submitted', hash);
    progress('succeeded', hash);
    return contract;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('shares wallet state across Contracts and Preview after confirmed deployment', async () => {
  render(<StrictMode><Workspace /></StrictMode>);
  const manager = within(screen.getByRole('region', { name: 'Contract configuration' }));
  const runtime = within(screen.getByRole('region', { name: 'Wallet regression runtime' }));
  expect(request.mock.calls.some(([call]) => call.method === 'eth_requestAccounts')).toBe(false);
  fireEvent.click(manager.getByRole('button', { name: 'Connect Injected' }));
  await waitFor(() => expect(manager.getByRole('button', { name: 'Disconnect' })).toBeTruthy());
  fireEvent.click(manager.getByRole('button', { name: 'Deploy template' }));
  fireEvent.change(manager.getByLabelText('Token name'), { target: { value: contract.name } });
  fireEvent.change(manager.getByLabelText('Symbol'), { target: { value: 'CONF' } });
  fireEvent.change(manager.getByLabelText('Initial supply recipient'), { target: { value: account } });
  fireEvent.click(manager.getByRole('button', { name: 'Simulate and review deployment' }));
  await manager.findByText('Project contracts (1)');
  expect(manager.getByText('Deployment transaction · succeeded')).toBeTruthy();
  expect(runtime.getByRole('heading', { name: 'Your token dashboard' })).toBeTruthy();
  expect(runtime.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
  expect(deployTemplate).toHaveBeenCalledTimes(1);

  fireEvent.click(runtime.getAllByRole('button', { name: 'Disconnect' })[0]);
  await waitFor(() => expect(manager.getByRole('button', { name: 'Connect Injected' })).toBeTruthy());
  expect(runtime.queryByRole('button', { name: 'Disconnect' })).toBeNull();
});
