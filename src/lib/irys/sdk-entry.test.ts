import { describe, expect, it, vi } from 'vitest';
import type { WalletClient } from 'viem';
import { assertSignerConsistency, signTypedDataWithConsistency } from './sdk-entry';

const address = `0x${'1'.repeat(40)}` as const;
const otherAddress = `0x${'2'.repeat(40)}` as const;
const signature = `0x${'3'.repeat(65)}` as const;
const typedData = {
  account: address,
  domain: { name: 'Irys upload', version: '1', chainId: 43113 },
  types: { Upload: [{ name: 'bundle', type: 'bytes32' }] },
  primaryType: 'Upload' as const,
  message: { bundle: `0x${'4'.repeat(64)}` as const },
};

function wallet(overrides: Partial<WalletClient> = {}) {
  return {
    account: { address },
    getAddresses: vi.fn(async () => [address]),
    signTypedData: vi.fn(async () => signature),
    ...overrides,
  } as unknown as WalletClient;
}

describe('Irys signer consistency', () => {
  it('rejects an adapter-selected account that differs from the quoted wallet before signing', async () => {
    const client = wallet({ getAddresses: vi.fn(async () => [otherAddress]) });
    await expect(assertSignerConsistency(client, address)).rejects.toThrow(/active signer/i);
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), typedData)).rejects.toThrow(/active signer/i);
    expect(client.signTypedData).not.toHaveBeenCalled();
  });

  it('keeps canonical typed-data arguments unchanged when signing', async () => {
    const client = wallet();
    const guard = vi.fn(async () => undefined);
    await expect(signTypedDataWithConsistency(client, address, guard, typedData)).resolves.toBe(signature);
    expect(client.signTypedData).toHaveBeenCalledOnce();
    expect(client.signTypedData).toHaveBeenCalledWith(typedData);
    expect(guard).toHaveBeenCalledOnce();
  });

  it('sanitizes Core nested active-wallet errors and does not retry', async () => {
    const client = wallet({ signTypedData: vi.fn(async () => { throw { originalError: { message: 'The account shown for this request is not part of the active wallet. Please re-initiate the request.' } }; }) });
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), typedData)).rejects.toThrow('Core rejected the upload authorization because the request account is not active in Core. Reconnect the intended Fuji account, prepare a fresh quote, then review the upload signature again.');
    expect(client.signTypedData).toHaveBeenCalledOnce();
  });
});
