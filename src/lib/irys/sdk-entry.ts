// Compiled to an editor-only browser module, never included in the published runtime.
import { WebUploader } from '@irys/web-upload';
import { WebAvalanche } from '@irys/web-upload-ethereum';
import { ViemV2Adapter } from '@irys/web-upload-ethereum-viem-v2';
import { ArweaveSigner } from '@irys/bundles/web';
import { Buffer } from 'buffer';
import { createPublicClient, http, isAddress, type WalletClient } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { validId, validManifest } from './journal';
import type { StorageAdapter } from './types';
const RPC = 'https://api.avax-test.network/ext/bc/C/rpc';

type SigningArguments = Parameters<WalletClient['signTypedData']>[0];

function sameAddress(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

/** The Irys adapter derives its signing account from getAddresses()[0], unlike viem's account field. */
export async function assertSignerConsistency(wallet: WalletClient, expectedAddress: string): Promise<void> {
  const [addresses, walletAccount] = await Promise.all([wallet.getAddresses(), Promise.resolve(wallet.account?.address)]);
  if (!sameAddress(walletAccount, expectedAddress) || !sameAddress(addresses[0], expectedAddress)) {
    throw new Error('Wallet account changed or does not match its active signer. Reconnect the intended Fuji account and prepare a fresh quote.');
  }
}

function hasCoreAccountMismatch(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0 && seen.size < 24) {
    const current = pending.pop();
    if (!current || (typeof current !== 'object' && typeof current !== 'string') || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === 'string') {
      if (current.toLowerCase().includes('account shown for this request is not part of the active wallet')) return true;
      continue;
    }
    const value = current as Record<string, unknown>;
    for (const key of ['message', 'shortMessage', 'details', 'originalError', 'cause', 'error', 'data']) pending.push(value[key]);
  }
  return false;
}

/** Never alters the canonical Irys typed-data payload and never retries a wallet signature. */
export async function signTypedDataWithConsistency(wallet: WalletClient, expectedAddress: string, guard: () => Promise<void>, args: SigningArguments) {
  await guard();
  await assertSignerConsistency(wallet, expectedAddress);
  try {
    return await wallet.signTypedData(args);
  } catch (error) {
    if (hasCoreAccountMismatch(error)) throw new Error('Core rejected the upload authorization because the request account is not active in Core. Reconnect the intended Fuji account, prepare a fresh quote, then review the upload signature again.');
    throw error;
  }
}

export async function connect(wallet: WalletClient, guard: () => Promise<void>): Promise<StorageAdapter> {
  await guard();
  const expectedAddress = wallet.account?.address;
  if (!expectedAddress) throw new Error('Connect a wallet deliberately before preparing a quote.');
  await assertSignerConsistency(wallet, expectedAddress);
  const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  if (await publicClient.getChainId() !== 43113) throw new Error('The storage payment RPC is not Fuji.');
  // The SDK is allowed only to request upload typed-data signatures. Funding is
  // performed separately through viem so its broadcast hash cannot be lost.
  const guardedWallet = {
    ...wallet,
    async signTypedData(args: SigningArguments) { return signTypedDataWithConsistency(wallet, expectedAddress, guard, args); },
    async sendTransaction(): Promise<never> { throw new Error('Implicit SDK funding is prohibited.'); },
  };
  const irys = await WebUploader(WebAvalanche).withAdapter(ViemV2Adapter(guardedWallet, { publicClient })).withRpc(RPC).devnet().bundlerUrl('https://devnet.irys.xyz').timeout(30_000);
  if (irys.url.origin !== 'https://devnet.irys.xyz' || irys.token !== 'avalanche' || irys.tokenConfig.ticker !== 'AVAX') throw new Error('Unexpected storage network or payment token.');
  if (!sameAddress(irys.address, expectedAddress)) throw new Error('Storage signer does not match the connected wallet.');
  await guard();
  await assertSignerConsistency(wallet, expectedAddress);
  return {
    address: irys.address,
    balance: async () => BigInt((await irys.getLoadedBalance()).toFixed(0)),
    fundingAddress: async () => {
      const address = await irys.utils.getBundlerAddress('avalanche');
      if (!isAddress(address)) throw new Error('Invalid devnet funding address.');
      return address;
    },
    submitFunding: async hash => { if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid funding hash.'); await irys.funder.submitFundTransaction(hash); },
    prepare: async files => {
      // Match uploadFolder's installed SDK format, but retain the prepared bundle
      // before wallet signing to quote its exact bytes and prevent blind retries.
      const key = await irys.bundles.getCryptoDriver().generateJWK();
      const signer = new ArweaveSigner(key);
      const items = [];
      const paths = new Map<string, string>();
      for (const file of files) {
        const item = irys.bundles.createData(Buffer.from(file.text, 'utf8'), signer, { tags: [{ name: 'Content-Type', value: file.type }] });
        await item.sign(signer);
        if (!validId(item.id)) throw new Error('Invalid asset transaction ID.');
        items.push(item); paths.set(file.name, item.id);
      }
      const manifest: unknown = await irys.uploader.generateFolder({ items: paths, indexFile: 'index.html' });
      if (!validManifest(manifest)) throw new Error('Unsupported SDK manifest format.');
      const manifestTx = irys.bundles.createData(JSON.stringify(manifest), signer, { tags: [{ name: 'Type', value: 'manifest' }, { name: 'Content-Type', value: 'application/x.irys-manifest+json' }] });
      await manifestTx.sign(signer);
      items.push(manifestTx);
      const bundle = await irys.bundles.bundleAndSignData(items, signer);
      const tx = irys.createTransaction(bundle.getRaw(), { tags: [{ name: 'Bundle-Format', value: 'binary' }, { name: 'Bundle-Version', value: '2.0.0' }] });
      const bytes = tx.size;
      let attempted = false;
      return {
        manifest, manifestId: manifestTx.id, bytes,
        price: async () => BigInt((await tx.getPrice()).toFixed(0)),
        upload: async onSigned => {
          if (attempted) throw new Error('Upload already attempted. Verify the retained ID instead of resubmitting.');
          await guard();
          await tx.sign();
          await guard();
          if (tx.size !== bytes || !validId(tx.id)) throw new Error('Signed bundle size or ID is invalid.');
          onSigned(tx.id); // Persist before the first network upload.
          attempted = true;
          const response = await tx.upload();
          if (response.id !== tx.id) throw new Error('Storage returned a different bundle ID; verify the retained manifest.');
          return response.id;
        },
      };
    },
  };
}
