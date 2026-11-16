import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAbi, type WalletClient } from 'viem';
import { FUJI_NETWORK, MAINNET_NETWORK } from '../schema';
import type { ContractConfig } from '../schema/types';
import { writeContract, waitReceipt, readJournal, journal } from './transactions';
import { deployTemplate } from './templates';
import { getFunctions, parseAbiJson, prepareCall } from './contracts';

const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getCode: vi.fn(), simulateContract: vi.fn(), estimateContractGas: vi.fn(), estimateGas: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock('./chains', async importOriginal => ({ ...await importOriginal<typeof import('./chains')>(), publicClientFor: () => rpc }));
const account = '0x1000000000000000000000000000000000000001' as const;
const hash = `0x${'ab'.repeat(32)}` as const;
const contract: ContractConfig = { id: 'token', name: 'Token', address: '0x2000000000000000000000000000000000000002', chainId: 43113, abi: parseAbi(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']), exposedFunctions: ['transfer(address,uint256)', 'balanceOf(address)'] };
const action = { contractId: 'token', functionSignature: 'transfer(address,uint256)', args: [{ value: account }, { value: '1.25', decimals: 18 }] };
const context = { state: {}, inputs: {}, steps: {}, wallet: { address: account, chainId: 43113 } };
function walletFixture() {
  const methods = { getAddresses: vi.fn(async () => [account]), getChainId: vi.fn(async () => 43113), writeContract: vi.fn(async () => hash), deployContract: vi.fn(async () => hash) };
  return { wallet: methods as unknown as WalletClient, methods };
}
beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  rpc.getChainId.mockResolvedValue(43113); rpc.getCode.mockResolvedValue('0x1234'); rpc.simulateContract.mockResolvedValue({}); rpc.estimateContractGas.mockResolvedValue(50_000n); rpc.estimateGas.mockResolvedValue(100_000n);
  rpc.waitForTransactionReceipt.mockResolvedValue({ status: 'success', transactionHash: hash });
});
afterEach(() => vi.unstubAllGlobals());
describe('write safety boundary', () => {
  it('simulates, reviews exact base-unit args and signer, then submits once', async () => {
    const { wallet, methods } = walletFixture(); const review = vi.fn(async () => true); const progress = vi.fn();
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, review, progress, () => false)).resolves.toBe(hash);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ account, chainId: 43113, args: [account, '1250000000000000000'], value: '0', method: 'transfer(address,uint256)' }));
    expect(methods.writeContract).toHaveBeenCalledTimes(1); expect(methods.getAddresses).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith('submitted', hash);
  });
  it('rejects Mainnet before contacting RPC or wallet', async () => {
    const { wallet, methods } = walletFixture();
    await expect(writeContract(MAINNET_NETWORK, contract, action, context, wallet, vi.fn(), vi.fn(), () => false)).rejects.toThrow(/only.*Fuji/);
    expect(methods.writeContract).not.toHaveBeenCalled(); expect(rpc.simulateContract).not.toHaveBeenCalled();
  });
  it('does not submit when account changes during consent', async () => {
    const { wallet, methods } = walletFixture();
    const review = vi.fn(async () => { methods.getAddresses.mockResolvedValue(['0x3000000000000000000000000000000000000003' as typeof account]); return true; });
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, review, vi.fn(), () => false)).rejects.toThrow(/account changed/);
    expect(methods.writeContract).not.toHaveBeenCalled();
  });
  it('does not submit when chain changes during consent', async () => {
    const { wallet, methods } = walletFixture();
    const review = vi.fn(async () => { methods.getChainId.mockResolvedValue(43114); return true; });
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, review, vi.fn(), () => false)).rejects.toThrow(/Fuji/);
    expect(methods.writeContract).not.toHaveBeenCalled();
  });
  it('stops on simulation failure, consent denial, or cancellation', async () => {
    const { wallet, methods } = walletFixture(); const review = vi.fn(async () => true);
    rpc.simulateContract.mockRejectedValueOnce(new Error('rpc secret must not leak'));
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, review, vi.fn(), () => false)).rejects.toThrow(/simulation failed/);
    expect(review).not.toHaveBeenCalled();
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, async () => false, vi.fn(), () => false)).rejects.toMatchObject({ status: 'cancelled' });
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, review, vi.fn(), () => true)).rejects.toMatchObject({ status: 'cancelled' });
    expect(methods.writeContract).not.toHaveBeenCalled();
  });
  it('keeps receipt timeout unknown and never retries submission', async () => {
    const { wallet, methods } = walletFixture(); rpc.waitForTransactionReceipt.mockRejectedValueOnce(new Error('timeout'));
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, async () => true, vi.fn(), () => false)).rejects.toMatchObject({ status: 'unknown' });
    expect(methods.writeContract).toHaveBeenCalledTimes(1);
  });
  it('distinguishes wallet rejection from an uncertain submission', async () => {
    const { wallet, methods } = walletFixture(); methods.writeContract.mockRejectedValueOnce({ code: 4001 });
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, async () => true, vi.fn(), () => false)).rejects.toMatchObject({ status: 'rejected' });
    methods.writeContract.mockRejectedValueOnce(new Error('transport lost'));
    await expect(writeContract(FUJI_NETWORK, contract, action, context, wallet, async () => true, vi.fn(), () => false)).rejects.toMatchObject({ status: 'unknown' });
    expect(methods.writeContract).toHaveBeenCalledTimes(2);
  });
  it.each(['cancelled', 'replaced'])('retains %s replacement disposition even if polling subsequently times out', async reason => {
    const replacementHash = `0x${'cd'.repeat(32)}` as const;
    rpc.waitForTransactionReceipt.mockImplementationOnce(async (options: { onReplaced: (event: unknown) => void }) => {
      options.onReplaced({ reason, transaction: { hash: replacementHash } }); throw new Error('timeout after replacement');
    });
    const progress = vi.fn();
    await expect(waitReceipt(FUJI_NETWORK, hash, 'deployment', progress)).rejects.toMatchObject({ status: 'cancelled' });
    expect(progress).toHaveBeenCalledWith('confirming', replacementHash);
    expect(readJournal()).toEqual(expect.arrayContaining([
      expect.objectContaining({ hash, intent: 'different', status: 'replaced' }),
      expect.objectContaining({ hash: replacementHash, intent: 'different' }),
    ]));
    journal({ hash: replacementHash, chainId: 43113, kind: 'deployment', status: 'success', timestamp: Date.now() });
    expect(readJournal().find(entry => entry.hash === replacementHash)?.intent).toBe('different');
  });
  it('keeps same-intent repricing unknown on timeout with the replacement hash retained', async () => {
    const replacementHash = `0x${'ef'.repeat(32)}` as const;
    rpc.waitForTransactionReceipt.mockImplementationOnce(async (options: { onReplaced: (event: unknown) => void }) => {
      options.onReplaced({ reason: 'repriced', transaction: { hash: replacementHash } }); throw new Error('timeout');
    });
    const progress = vi.fn();
    await expect(waitReceipt(FUJI_NETWORK, hash, 'deployment', progress)).rejects.toMatchObject({ status: 'unknown' });
    expect(progress).toHaveBeenCalledWith('confirming', replacementHash);
    expect(readJournal().find(entry => entry.hash === replacementHash)?.intent).toBeUndefined();
  });
  it('keeps post-confirmed deployment code RPC errors unknown with hash and no resubmission', async () => {
    const { wallet, methods } = walletFixture(); const progress = vi.fn();
    rpc.waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success', transactionHash: hash, contractAddress: contract.address });
    rpc.getCode.mockRejectedValueOnce(new Error('RPC is unavailable'));
    await expect(deployTemplate(FUJI_NETWORK, { templateId: 'erc20-fixed-v1', name: 'Token', symbol: 'TOK', owner: account, supply: '100' }, wallet, async () => true, progress)).rejects.toMatchObject({ status: 'unknown', message: expect.stringContaining('receipt succeeded') });
    expect(methods.deployContract).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith('submitted', hash);
    expect(readJournal()).toEqual(expect.arrayContaining([expect.objectContaining({ hash, status: 'success', kind: 'deployment' })]));
  });
  it('halts on replacement cancellation but accepts same-intent fee repricing', async () => {
    const replacementHash = `0x${'cd'.repeat(32)}`;
    for (const reason of ['cancelled', 'replaced', 'repriced']) {
      rpc.waitForTransactionReceipt.mockImplementationOnce(async (options: { onReplaced: (event: unknown) => void }) => {
        options.onReplaced({ reason, transaction: { hash: replacementHash } }); return { status: 'success', transactionHash: replacementHash };
      });
      const result = waitReceipt(FUJI_NETWORK, hash, 'write', vi.fn());
      if (reason === 'repriced') await expect(result).resolves.toMatchObject({ transactionHash: replacementHash });
      else await expect(result).rejects.toMatchObject({ status: 'cancelled' });
    }
  });
});
describe('ABI interaction boundary', () => {
  it('identifies overloads canonically and marks tuple/array functions unsupported', () => {
    const descriptors = getFunctions(parseAbi(['function foo(uint256)', 'function foo(address)', 'function batch(uint256[])', 'function output() view returns (uint256[])']));
    expect(descriptors.map(item => item.signature)).toEqual(['foo(uint256)', 'foo(address)', 'batch(uint256[])', 'output()']);
    expect(descriptors.map(item => item.supported)).toEqual([true, true, false, false]);
  });
  it('does not permit unexposed functions or payable value on transfer', () => {
    expect(() => prepareCall({ ...contract, exposedFunctions: [] }, action, context)).toThrow(/not exposed/);
    expect(() => prepareCall(contract, { ...action, value: '1' }, context)).toThrow(/payable/);
  });
  it('rejects malformed ABI and duplicate canonical functions', () => {
    expect(() => parseAbiJson('{broken')).toThrow();
    expect(() => parseAbiJson(JSON.stringify([{ type: 'function', name: 'bad', inputs: [], outputs: [], stateMutability: 'secret' }]))).toThrow();
    expect(() => parseAbiJson(JSON.stringify([...contract.abi, contract.abi[0]]))).toThrow(/Duplicate/);
  });
});
