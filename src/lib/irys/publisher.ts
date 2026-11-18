import type { WalletClient } from 'viem';
import { avalancheFuji } from 'viem/chains';
import type { ImpactorProjectSchema } from '@/lib/schema/types';
import { prepareSite, snapshotText } from './site';
import { readFunding, readPublications, saveFunding, savePublication, validId, validManifest } from './journal';
import type { FundingRecord, PreparedUpload, PublishRecord, SitePackage, StorageAdapter, StorageSDK } from './types';

export interface PublishQuote { site: SitePackage; prepared: PreparedUpload; adapter: StorageAdapter; price: bigint; balance: bigint; target: `0x${string}`; address: string; snapshot: string; expires: number; wallet: WalletClient }
export interface PublishState { busy: boolean; progress: string; error?: string; quote?: PublishQuote; result?: PublishRecord; funding?: FundingRecord }
let sdkPromise: Promise<StorageSDK> | undefined;
export function loadStorageSDK(): Promise<StorageSDK> {
  if (!sdkPromise) sdkPromise = new Promise<StorageSDK>((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/publish-runtime/sdk.js'; script.async = true;
    script.onload = () => { const sdk = (window as unknown as { ImpactorStorageSDK?: StorageSDK }).ImpactorStorageSDK; if (sdk?.connect) resolve(sdk); else reject(new Error('Browser storage SDK is unavailable.')); };
    script.onerror = () => { script.remove(); reject(new Error('Could not load the storage SDK.')); };
    document.head.append(script);
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}
export async function assertWallet(wallet: WalletClient, address: string): Promise<void> {
  const [chain, accounts] = await Promise.all([wallet.getChainId(), wallet.getAddresses()]);
  if (chain !== 43113 || wallet.account?.address?.toLowerCase() !== address.toLowerCase() || accounts[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('Wallet or chain changed. Reconnect on Fuji and prepare a fresh quote.');
}
function rejected(error: unknown): boolean {
  let current = error;
  for (let i = 0; i < 6 && current && typeof current === 'object'; i++) { if ('code' in current && current.code === 4001) return true; current = 'cause' in current ? current.cause : undefined; }
  return false;
}
/** Long-lived session: modal close/reopen never recreates an in-flight operation. */
export class Publisher {
  state: PublishState = { busy: false, progress: '' };
  constructor(private currentProject: () => ImpactorProjectSchema, private emit: (state: PublishState) => void, private deps = { prepareSite, loadStorageSDK }, private selectedWallet?: () => { address?: string; chainId?: number; isConnected: boolean }) {}
  private assertSelected(address: string) {
    if (!this.selectedWallet) return;
    const selected = this.selectedWallet();
    if (!selected.isConnected || selected.chainId !== 43113 || selected.address?.toLowerCase() !== address.toLowerCase()) throw new Error('Selected wallet changed or disconnected. Reconnect and prepare again.');
  }
  private set(patch: Partial<PublishState>) { this.state = { ...this.state, ...patch }; this.emit(this.state); }
  private async operation(task: () => Promise<void>, exclusive = false) {
    if (this.state.busy) return;
    this.set({ busy: true, error: undefined });
    try {
      if (exclusive) {
        if (!navigator.locks) throw new Error('Publishing requires a secure browser with Web Locks to prevent duplicate operations across tabs.');
        await navigator.locks.request('impactor-publish-wallet', { ifAvailable: true }, async lock => { if (!lock) throw new Error('Another tab is publishing. Wait for it to finish.'); await task(); });
      } else await task();
    } catch (error) { this.set({ error: error instanceof Error ? error.message : 'Publishing operation failed.' }); }
    finally { this.set({ busy: false }); }
  }
  private async fresh(q: PublishQuote, allowExpired = false) {
    if (snapshotText(this.currentProject()) !== q.snapshot) throw new Error('Project changed. Prepare a fresh snapshot and quote.');
    this.assertSelected(q.address);
    await assertWallet(q.wallet, q.address);
    this.assertSelected(q.address);
    if (snapshotText(this.currentProject()) !== q.snapshot) throw new Error('Project changed. Prepare a fresh snapshot and quote.');
    if (!allowExpired && Date.now() > q.expires) throw new Error('Quote expired. Prepare a fresh quote before spending.');
  }
  prepare(wallet: WalletClient): Promise<void> {
    return this.operation(async () => {
      const project = structuredClone(this.currentProject());
      const snapshot = snapshotText(project);
      const address = wallet.account?.address;
      if (!address) throw new Error('Connect a wallet deliberately before preparing a quote.');
      await assertWallet(wallet, address);
      this.set({ progress: 'Preparing validated static website and exact bundle quote…', quote: undefined, result: undefined, funding: readFunding(address) });
      const site = await this.deps.prepareSite(project);
      const existing = readPublications().find(r => r.fingerprint === site.fingerprint && r.address.toLowerCase() === address.toLowerCase() && r.bundleId);
      if (existing) { this.set({ result: existing, progress: 'An upload was already attempted for this snapshot. Verify it; do not pay again.' }); return; }
      const guard = async () => { if (snapshotText(this.currentProject()) !== snapshot) throw new Error('Project changed during publishing.'); this.assertSelected(address); await assertWallet(wallet, address); this.assertSelected(address); if (snapshotText(this.currentProject()) !== snapshot) throw new Error('Project changed during publishing.'); };
      const sdk = await this.deps.loadStorageSDK();
      const adapter = await sdk.connect(wallet, guard);
      const prepared = await adapter.prepare(site.files);
      if (!validId(prepared.manifestId) || !validManifest(prepared.manifest)) throw new Error('Storage returned an unsupported manifest.');
      const [price, balance, target] = await Promise.all([prepared.price(), adapter.balance(), adapter.fundingAddress()]);
      if (price < 0n || balance < 0n) throw new Error('Invalid storage quote.');
      await guard();
      this.set({ quote: { site, prepared, adapter, price, balance, target, address, snapshot, expires: Date.now() + 300_000, wallet }, progress: 'Quote ready. Nothing has been funded, wallet-signed or uploaded.' });
    });
  }
  fund(): Promise<void> {
    return this.operation(async () => {
      const q = this.state.quote; if (!q) throw new Error('Prepare a quote first.');
      await this.fresh(q);
      // A separately prepared tab may still hold a zero-balance quote after another
      // tab has completed this exact publication. Check durable upload history before
      // reading a stale balance or opening a second payment prompt.
      if (readPublications().some(r => r.fingerprint === q.site.fingerprint && r.address.toLowerCase() === q.address.toLowerCase() && r.bundleId)) throw new Error('This snapshot was already submitted. Use verification recovery.');
      const prior = readFunding(q.address);
      if (prior && prior.status !== 'credited') { this.set({ funding: prior }); throw new Error('Earlier funding may have been broadcast. Check its credit instead of paying again.'); }
      const [price, balance, target] = await Promise.all([q.prepared.price(), q.adapter.balance(), q.adapter.fundingAddress()]);
      if (price !== q.price || balance !== q.balance || target.toLowerCase() !== q.target.toLowerCase()) throw new Error('Price, balance or recipient changed. Prepare a new quote and review it.');
      const amount = price - balance;
      if (amount <= 0n) throw new Error('Storage balance already covers this upload. No funding needed.');
      await this.fresh(q);
      const record: FundingRecord = { address: q.address, target, amount: amount.toString(), status: 'pending', timestamp: Date.now() };
      saveFunding(q.address, record); this.set({ funding: record, progress: 'Review the Fuji test AVAX payment plus gas in your wallet…' });
      let hash: `0x${string}`;
      try { hash = await q.wallet.sendTransaction({ account: q.address as `0x${string}`, chain: avalancheFuji, to: target, value: amount }); }
      catch (error) {
        if (rejected(error)) { saveFunding(q.address); this.set({ funding: undefined }); }
        else { record.status = 'uncertain'; saveFunding(q.address, record); this.set({ funding: { ...record } }); }
        throw error;
      }
      record.hash = hash; record.status = 'uncertain';
      this.set({ funding: { ...record }, progress: 'Funding broadcast. Checking storage credit; do not send another payment.' });
      saveFunding(q.address, record); // Hash is retained before network confirmation/credit.
      await q.adapter.submitFunding(hash);
      const creditedBalance = await q.adapter.balance();
      if (creditedBalance < price) throw new Error('Funding submitted but credit is still pending. Retry the credit check only.');
      record.status = 'credited'; saveFunding(q.address, record);
      this.set({ funding: { ...record }, quote: { ...q, balance: creditedBalance }, progress: 'Storage credit available. Upload still requires a separate explicit signature.' });
    }, true);
  }
  recoverFunding(wallet: WalletClient, providedHash?: string): Promise<void> {
    return this.operation(async () => {
      const address = wallet.account?.address; if (!address) throw new Error('Connect the original funding wallet.');
      await assertWallet(wallet, address);
      const record = readFunding(address); if (!record) throw new Error('No local funding record for this wallet.');
      const hash = record.hash || providedHash;
      if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Find the original Fuji transaction hash in your wallet and enter it. Never send a replacement blindly.');
      // Submission only asks Irys to re-evaluate an existing transaction; no wallet signatures.
      record.hash = hash; saveFunding(address, record); this.set({ funding: record });
      const sdk = await this.deps.loadStorageSDK();
      const adapter = await sdk.connect(wallet, () => assertWallet(wallet, address));
      await adapter.submitFunding(hash);
      const balance = await adapter.balance();
      const q = this.state.quote;
      if (balance < (q?.price ?? BigInt(record.amount))) throw new Error('Credit is not yet sufficient. Wait and retry the same hash.');
      record.status = 'credited'; saveFunding(address, record);
      this.set({ funding: { ...record }, ...(q && q.address.toLowerCase() === address.toLowerCase() ? { quote: { ...q, balance } } : {}), progress: 'Storage balance checked. Prepare a quote if needed; nothing was paid again.' });
    }, true);
  }
  upload(): Promise<void> {
    return this.operation(async () => {
      const q = this.state.quote; if (!q) throw new Error('Prepare a quote first.');
      await this.fresh(q);
      if (readPublications().some(r => r.fingerprint === q.site.fingerprint && r.address.toLowerCase() === q.address.toLowerCase() && r.bundleId)) throw new Error('This snapshot was already submitted. Use verification recovery.');
      const [price, balance] = await Promise.all([q.prepared.price(), q.adapter.balance()]);
      if (price !== q.price) throw new Error('Price changed. Prepare and review a fresh quote.');
      if (balance < price) throw new Error('Insufficient storage credit. Funding is a separate explicit action.');
      await this.fresh(q);
      const record: PublishRecord = { version: 1, address: q.address, fingerprint: q.site.fingerprint, manifestId: q.prepared.manifestId, manifest: q.prepared.manifest, digests: q.site.digests, uploaded: false, verified: false, timestamp: Date.now() };
      savePublication(record); // Ensure recovery storage is writable before signing.
      this.set({ progress: 'Review the upload authorization in your wallet. It spends the quoted storage balance, not another AVAX payment.' });
      await q.prepared.upload(id => { record.bundleId = id; this.set({ result: { ...record }, progress: 'Uploading signed website. Retain its ID; do not resubmit on a timeout.' }); savePublication(record); });
      record.uploaded = true; savePublication(record);
      this.set({ result: { ...record }, progress: 'Upload accepted. Gateway verification is still required.' });
    }, true);
  }
  startNew() { if (!this.state.busy) this.set({ result: undefined, quote: undefined, error: undefined, progress: 'Prepare a different snapshot. Existing publication IDs remain in local history.' }); }
  restore(record: PublishRecord) { if (!this.state.busy) this.set({ result: record, quote: undefined, error: undefined, progress: 'Recovered local publication. Verification never pays or uploads again.' }); }
  verify(verifyRecord: (record: PublishRecord) => Promise<void>): Promise<void> {
    return this.operation(async () => {
      const record = this.state.result; if (!record) throw new Error('No publication ID to verify.');
      this.set({ progress: 'Checking root HTML and every manifest-routed file against the prepared website…' });
      await verifyRecord(record);
      const verified = { ...record, verified: true }; savePublication(verified);
      this.set({ result: verified, progress: 'Gateway root HTML and all manifest-routed assets match. Raw manifest JSON was not independently fetched. Availability is temporary, not guaranteed.' });
    });
  }
}
