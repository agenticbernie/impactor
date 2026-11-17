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

export async function connect(wallet: WalletClient, guard: () => Promise<void>): Promise<StorageAdapter> {
  await guard();
  const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
  if (await publicClient.getChainId() !== 43113) throw new Error('The storage payment RPC is not Fuji.');
  // The SDK is allowed only to request upload typed-data signatures. Funding is
  // performed separately through viem so its broadcast hash cannot be lost.
  const guardedWallet = {
    ...wallet,
    async signTypedData(args: Parameters<WalletClient['signTypedData']>[0]) { await guard(); return wallet.signTypedData(args); },
    async sendTransaction(): Promise<never> { throw new Error('Implicit SDK funding is prohibited.'); },
  };
  const irys = await WebUploader(WebAvalanche).withAdapter(ViemV2Adapter(guardedWallet, { publicClient })).withRpc(RPC).devnet().bundlerUrl('https://devnet.irys.xyz').timeout(30_000);
  if (irys.url.origin !== 'https://devnet.irys.xyz' || irys.token !== 'avalanche' || irys.tokenConfig.ticker !== 'AVAX') throw new Error('Unexpected storage network or payment token.');
  if (!wallet.account || irys.address.toLowerCase() !== wallet.account.address.toLowerCase()) throw new Error('Storage signer does not match the connected wallet.');
  await guard();
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
