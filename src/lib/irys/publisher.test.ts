import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletClient } from 'viem';
import { createProject } from '@/lib/schema';
import { Publisher } from './publisher';
import { snapshotText } from './site';
import { readFunding, readPublications } from './journal';
import type { FolderManifest, PreparedUpload, SitePackage, StorageAdapter, StorageSDK } from './types';

const address = `0x${'1'.repeat(40)}` as const;
const hash = `0x${'2'.repeat(64)}` as const;
const id = 'a'.repeat(43);
const manifest: FolderManifest = { manifest: 'irys/paths', version: '0.1.0', index: { path: 'index.html' }, paths: Object.fromEntries(['index.html', 'app.js', 'app.css', 'project.json', 'LICENSES.txt'].map(name => [name, { id }])) };
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
});
function setup(balance = 0n) {
  let project = createProject('Publish', 'blank');
  let currentBalance = balance;
  const wallet = { account: { address }, getChainId: vi.fn(async () => 43113), getAddresses: vi.fn(async () => [address]), sendTransaction: vi.fn(async () => hash) };
  const site: SitePackage = { files: [], fingerprint: 'b'.repeat(64), bytes: 10, digests: Object.fromEntries(Object.keys(manifest.paths).map(name => [name, { bytes: 10, sha256: 'b'.repeat(64) }])) };
  const prepared: PreparedUpload = { manifest, manifestId: id, bytes: 100, price: vi.fn(async () => 100n), upload: vi.fn(async onSigned => { onSigned('c'.repeat(43)); return 'c'.repeat(43); }) };
  const adapter: StorageAdapter = { address, balance: vi.fn(async () => currentBalance), prepare: vi.fn(async () => prepared), fundingAddress: vi.fn(async () => address), submitFunding: vi.fn(async () => { currentBalance = 100n; }) };
  const sdk: StorageSDK = { connect: vi.fn(async () => adapter) };
  const publisher = new Publisher(() => project, vi.fn(), { prepareSite: vi.fn(async () => site), loadStorageSDK: vi.fn(async () => sdk) });
  return { publisher, wallet, prepared, adapter, site, setProject: () => { project = { ...project, name: 'Changed' }; }, project: () => project, prepare: () => publisher.prepare(wallet as unknown as WalletClient) };
}
describe('explicit publication state machine', () => {
  it('prepares without signatures, payment or upload; uses the exact snapshot and price', async () => {
    const s = setup(); await s.prepare();
    expect(s.publisher.state.quote?.snapshot).toBe(snapshotText(s.project()));
    expect(s.publisher.state.quote?.prepared.bytes).toBe(100);
    expect(s.wallet.sendTransaction).not.toHaveBeenCalled(); expect(s.prepared.upload).not.toHaveBeenCalled();
    await s.publisher.upload(); expect(s.publisher.state.error).toMatch(/Insufficient/); expect(s.prepared.upload).not.toHaveBeenCalled();
  });
  it('separates explicit payment from explicit upload and retains IDs before verification', async () => {
    const s = setup(); await s.prepare(); await s.publisher.fund();
    expect(s.wallet.sendTransaction).toHaveBeenCalledOnce(); expect(s.prepared.upload).not.toHaveBeenCalled();
    expect(readFunding(address)).toMatchObject({ hash, status: 'credited' });
    await s.publisher.upload(); expect(s.prepared.upload).toHaveBeenCalledOnce();
    expect(readPublications()[0]).toMatchObject({ manifestId: id, uploaded: true, verified: false });
    const verify = vi.fn().mockRejectedValueOnce(new Error('Indexing pending')).mockResolvedValueOnce(undefined);
    await s.publisher.verify(verify); expect(s.publisher.state.result?.manifestId).toBe(id);
    await s.publisher.verify(verify); expect(s.publisher.state.result?.verified).toBe(true);
    expect(s.prepared.upload).toHaveBeenCalledOnce(); expect(s.wallet.sendTransaction).toHaveBeenCalledOnce();
  });
  it('invalidates before side effects for changed project, chain, wallet and expired quote', async () => {
    for (const change of ['project', 'chain', 'wallet', 'expiry']) {
      const s = setup(); await s.prepare();
      if (change === 'project') s.setProject();
      if (change === 'chain') s.wallet.getChainId.mockResolvedValue(43114);
      if (change === 'wallet') s.wallet.getAddresses.mockResolvedValue([`0x${'3'.repeat(40)}` as typeof address]);
      if (change === 'expiry') s.publisher.state.quote!.expires = 0;
      await s.publisher.fund(); expect(s.publisher.state.error).toBeTruthy(); expect(s.wallet.sendTransaction).not.toHaveBeenCalled();
    }
  });
  it('rechecks a project changed while the live wallet guard was awaiting', async () => {
    const s = setup(); await s.prepare();
    s.wallet.getChainId.mockImplementationOnce(async () => { s.setProject(); return 43113; });
    await s.publisher.fund(); expect(s.wallet.sendTransaction).not.toHaveBeenCalled(); expect(s.publisher.state.error).toMatch(/Project changed/);
  });
  it('does not spend when another browser tab holds the publication lock', async () => {
    const s = setup(); await s.prepare();
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<void>) => callback(null) } });
    await s.publisher.fund(); expect(s.wallet.sendTransaction).not.toHaveBeenCalled(); expect(s.publisher.state.error).toMatch(/Another tab/);
  });
  it('rejects wrong-chain preparation without preparing the SDK', async () => {
    const s = setup(); s.wallet.getChainId.mockResolvedValue(43114); await s.prepare(); expect(s.adapter.prepare).not.toHaveBeenCalled();
  });
  it('rejects a changed viem account before a funding request', async () => {
    const s = setup(); await s.prepare();
    s.wallet.account.address = `0x${'3'.repeat(40)}` as typeof address;
    await s.publisher.fund();
    expect(s.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(s.publisher.state.error).toMatch(/Wallet or chain changed/);
  });
  it('requires review again if fresh price, credit or funding recipient changed', async () => {
    const s = setup(); await s.prepare(); vi.mocked(s.prepared.price).mockResolvedValue(101n); await s.publisher.fund();
    expect(s.wallet.sendTransaction).not.toHaveBeenCalled(); expect(s.publisher.state.error).toMatch(/changed/);
  });
  it('retains broadcast hash if credit fails, blocks duplicate payment and retries only credit', async () => {
    const s = setup(); await s.prepare(); vi.mocked(s.adapter.submitFunding).mockRejectedValueOnce(new Error('credit timeout'));
    await s.publisher.fund(); expect(readFunding(address)).toMatchObject({ hash, status: 'uncertain' });
    await s.publisher.fund(); expect(s.wallet.sendTransaction).toHaveBeenCalledOnce();
    await s.publisher.recoverFunding(s.wallet as unknown as WalletClient);
    expect(s.wallet.sendTransaction).toHaveBeenCalledOnce(); expect(readFunding(address)?.status).toBe('credited');
  });
  it('unresolved wallet errors without a hash stay blocked; explicit rejection permits retry', async () => {
    const s = setup(); await s.prepare(); s.wallet.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    await s.publisher.fund(); expect(readFunding(address)).toBeUndefined();
    s.wallet.sendTransaction.mockRejectedValueOnce(new Error('wallet transport disconnected'));
    await s.publisher.fund(); expect(readFunding(address)?.status).toBe('uncertain');
    await s.publisher.fund(); expect(s.wallet.sendTransaction).toHaveBeenCalledTimes(2);
  });
  it('blocks stale-tab funding after another prepared session funds and publishes the same snapshot', async () => {
    const first = setup(), second = setup();
    await first.prepare(); await second.prepare();
    expect(first.publisher.state.quote?.balance).toBe(0n);
    expect(second.publisher.state.quote?.balance).toBe(0n);
    await first.publisher.fund(); await first.publisher.upload();
    expect(readFunding(address)?.status).toBe('credited');
    expect(readPublications()[0]?.bundleId).toBeTruthy();
    // Credit was consumed by the first publication; the second tab's zero balance,
    // price and recipient still match its stale quote, but it must not pay again.
    expect(await second.adapter.balance()).toBe(0n);
    expect(await second.prepared.price()).toBe(second.publisher.state.quote?.price);
    await second.publisher.fund();
    expect(second.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(second.publisher.state.error).toMatch(/already submitted/);
    expect(first.wallet.sendTransaction).toHaveBeenCalledOnce();
  });
  it('never resubmits a possibly accepted upload, including across Publisher instances', async () => {
    const s = setup(100n); await s.prepare();
    vi.mocked(s.prepared.upload).mockImplementationOnce(async onSigned => { onSigned('c'.repeat(43)); throw new Error('response lost'); });
    await s.publisher.upload(); expect(s.publisher.state.result?.bundleId).toBeTruthy();
    await s.publisher.upload(); expect(s.prepared.upload).toHaveBeenCalledOnce();
    const another = setup(100n); await another.prepare(); expect(another.publisher.state.result?.manifestId).toBe(id); expect(another.adapter.prepare).not.toHaveBeenCalled();
  });
  it('rejected upload signing leaves no submitted bundle and never pays', async () => {
    const s = setup(100n); await s.prepare(); vi.mocked(s.prepared.upload).mockRejectedValueOnce(new Error('User rejected signing'));
    await s.publisher.upload(); expect(s.publisher.state.result).toBeUndefined(); expect(readPublications()[0]?.bundleId).toBeUndefined(); expect(s.wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it('blocks repeat clicks while preparing and prevents spending without recovery storage', async () => {
    const s = setup(); await Promise.all([s.prepare(), s.prepare()]); expect(s.adapter.prepare).toHaveBeenCalledOnce();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('storage blocked'); } });
    await s.publisher.fund(); expect(s.wallet.sendTransaction).not.toHaveBeenCalled(); expect(s.publisher.state.error).toMatch(/storage blocked/);
  });
});
