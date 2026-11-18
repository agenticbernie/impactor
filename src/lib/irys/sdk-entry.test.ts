import { createWalletClient, custom, getAddress, hashTypedData, type WalletClient } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { assertSignerConsistency, signTypedDataWithConsistency } from './sdk-entry';

const address = `0x${'1'.repeat(40)}` as const;
const otherAddress = `0x${'2'.repeat(40)}` as const;
const checksumAddress = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
const signature = `0x${'3'.repeat(65)}` as const;
const typedData = {
  domain: { name: 'Bundlr', version: '1' },
  types: { Bundlr: [{ name: 'Transaction hash', type: 'bytes' }, { name: 'address', type: 'address' }] },
  primaryType: 'Bundlr' as const,
  message: { 'Transaction hash': `0x${'4'.repeat(64)}`, address: address as `0x${string}` },
};

interface WalletOverrides {
  account?: { address: `0x${string}` };
  getAddresses?: () => Promise<`0x${string}`[]>;
  request?: (args: { method: string }) => Promise<unknown>;
  signTypedData?: () => Promise<`0x${string}`>;
}

function wallet(overrides: WalletOverrides = {}) {
  return {
    account: { address },
    getAddresses: vi.fn(async () => [address]),
    request: vi.fn(async ({ method }: { method: string }) => method === 'eth_accounts' ? [address] : []),
    signTypedData: vi.fn(async () => signature),
    sendTransaction: vi.fn(),
    ...overrides,
  } as unknown as WalletClient;
}

describe('Irys signer consistency', () => {
  it('rejects an adapter-selected account that differs from the quoted wallet before signing', async () => {
    const client = wallet({ getAddresses: vi.fn(async () => [otherAddress]) });
    await expect(assertSignerConsistency(client, address)).rejects.toThrow(/active signer/i);
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), { ...typedData, account: address })).rejects.toThrow(/active signer/i);
    expect(client.signTypedData).not.toHaveBeenCalled();
  });

  it('uses Core raw eth_accounts casing only for the account selector and preserves signed data', async () => {
    const client = wallet({
      account: { address: checksumAddress },
      getAddresses: vi.fn(async () => [checksumAddress]),
      request: vi.fn(async ({ method }: { method: string }) => method === 'eth_accounts' ? [checksumAddress] : []),
    });
    const guard = vi.fn(async () => undefined);
    const args = { ...typedData, account: checksumAddress.toLowerCase() as `0x${string}` };
    const digestBefore = hashTypedData(args);

    await expect(signTypedDataWithConsistency(client, checksumAddress, guard, args)).resolves.toBe(signature);

    expect(client.request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_accounts' });
    expect(client.signTypedData).toHaveBeenCalledOnce();
    const forwarded = vi.mocked(client.signTypedData).mock.calls[0][0];
    expect(forwarded.account).toBe(checksumAddress);
    expect(forwarded.domain).toBe(args.domain);
    expect(forwarded.types).toBe(args.types);
    expect(forwarded.primaryType).toBe(args.primaryType);
    expect(forwarded.message).toBe(args.message);
    expect(hashTypedData(forwarded)).toBe(digestBefore);
    expect(client.sendTransaction).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledOnce();
  });

  it('reproduces Core strict address lookup while the typed-data digest stays unchanged', async () => {
    const coreEthAccounts: string[] = [checksumAddress];
    const rpcRequests: Array<{ method: string; params?: readonly unknown[] }> = [];
    const viemWallet = createWalletClient({
      account: checksumAddress,
      transport: custom({
        request: async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
          rpcRequests.push({ method, params });
          if (method === 'eth_accounts') return coreEthAccounts;
          if (method === 'eth_signTypedData_v4') {
            const requestedAccount = params?.[0];
            if (typeof requestedAccount !== 'string' || !coreEthAccounts.includes(requestedAccount)) {
              throw new Error('The account shown for this request is not part of the active wallet. Please re-initiate the request.');
            }
            return signature;
          }
          throw new Error(`Unexpected wallet request: ${method}`);
        },
      }),
    });
    const args = { ...typedData, account: checksumAddress.toLowerCase() as `0x${string}` };
    const digestBefore = hashTypedData(args);

    // Without the adapter boundary correction, Core's strict account lookup fails.
    await expect(viemWallet.signTypedData(args)).rejects.toThrow(/not part of the active wallet/);
    const originalSigningRequest = rpcRequests[0];
    rpcRequests.length = 0;

    await signTypedDataWithConsistency(viemWallet, checksumAddress, async () => undefined, args);

    expect(rpcRequests.map(request => request.method)).toEqual(['eth_accounts', 'eth_accounts', 'eth_signTypedData_v4']);
    const signingRequest = rpcRequests[2];
    expect(signingRequest.params?.[0]).toBe(checksumAddress);
    expect(signingRequest.params?.[1]).toBe(originalSigningRequest.params?.[1]);
    const signedPayload = JSON.parse(signingRequest.params?.[1] as string);
    expect(signedPayload).toMatchObject({
      domain: args.domain,
      types: args.types,
      primaryType: args.primaryType,
      message: args.message,
    });
    expect(hashTypedData(signedPayload)).toBe(digestBefore);
  });

  it.each([
    ['no accounts', []],
    ['malformed account', ['not-an-address']],
    ['different account', [otherAddress]],
    ['missing accounts', null],
  ])('fails closed for %s without signing or payment', async (_label, accounts) => {
    const client = wallet({ request: vi.fn(async () => accounts) });
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), { ...typedData, account: address })).rejects.toThrow(/active wallet account changed/i);
    expect(client.signTypedData).not.toHaveBeenCalled();
    expect(client.sendTransaction).not.toHaveBeenCalled();
  });

  it('fails closed if raw account lookup rejects and never requests new permissions', async () => {
    const client = wallet({ request: vi.fn(async () => { throw new Error('provider unavailable'); }) });
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), { ...typedData, account: address })).rejects.toThrow('provider unavailable');
    expect(client.signTypedData).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(client.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unexpected adapter account before querying or signing', async () => {
    const client = wallet();
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), { ...typedData, account: otherAddress })).rejects.toThrow(/unexpected upload signer/i);
    expect(client.request).not.toHaveBeenCalled();
    expect(client.signTypedData).not.toHaveBeenCalled();
  });

  it('preserves raw provider spelling even when getAddresses returns another casing', async () => {
    const rawAddress = checksumAddress.toLowerCase() as `0x${string}`;
    const client = wallet({
      account: { address: checksumAddress },
      getAddresses: vi.fn(async () => [checksumAddress]),
      request: vi.fn(async () => [rawAddress]),
    });
    await signTypedDataWithConsistency(client, checksumAddress, async () => undefined, { ...typedData, account: checksumAddress });
    expect(client.signTypedData).toHaveBeenCalledWith({ ...typedData, account: rawAddress });
  });

  it('requires the adapter account to be a string, with no implicit account fallback', async () => {
    for (const account of [undefined, { address, type: 'json-rpc' as const }]) {
      const client = wallet();
      await expect(signTypedDataWithConsistency(client, address, async () => undefined, { ...typedData, account } as unknown as Parameters<typeof signTypedDataWithConsistency>[3])).rejects.toThrow(/unexpected upload signer/i);
      expect(client.request).not.toHaveBeenCalled();
      expect(client.signTypedData).not.toHaveBeenCalled();
    }
  });

  it('stops if the wallet guard rejects or the raw account changes during lookup', async () => {
    const client = wallet();
    await expect(signTypedDataWithConsistency(client, address, async () => { throw new Error('Selected wallet changed'); }, { ...typedData, account: address })).rejects.toThrow('Selected wallet changed');
    expect(client.request).not.toHaveBeenCalled();
    expect(client.signTypedData).not.toHaveBeenCalled();

    const switched = wallet({ request: vi.fn(async () => [otherAddress]) });
    await expect(signTypedDataWithConsistency(switched, address, async () => undefined, { ...typedData, account: address })).rejects.toThrow(/active wallet account changed/i);
    expect(switched.signTypedData).not.toHaveBeenCalled();
    expect(switched.sendTransaction).not.toHaveBeenCalled();
  });

  it('sanitizes Core nested active-wallet errors and does not retry', async () => {
    const client = wallet({ signTypedData: vi.fn(async () => { throw { originalError: { message: 'The account shown for this request is not part of the active wallet. Please re-initiate the request.' } }; }) });
    await expect(signTypedDataWithConsistency(client, address, vi.fn(async () => undefined), { ...typedData, account: address })).rejects.toThrow('Core rejected the upload authorization because the request account is not active in Core. Reconnect the intended Fuji account, prepare a fresh quote, then review the upload signature again.');
    expect(client.signTypedData).toHaveBeenCalledOnce();
    expect(client.sendTransaction).not.toHaveBeenCalled();
  });
});
