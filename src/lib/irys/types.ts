import type { WalletClient } from 'viem';
export interface SiteFile { name: string; type: string; text: string }
export interface AssetDigest { bytes: number; sha256: string }
export interface SitePackage { files: SiteFile[]; fingerprint: string; digests: Record<string, AssetDigest>; bytes: number }
export interface FolderManifest { manifest: 'irys/paths'; version: '0.1.0'; index: { path: 'index.html' }; paths: Record<string, { id: string }> }
export interface PreparedUpload {
  manifest: FolderManifest;
  manifestId: string;
  bytes: number;
  price(): Promise<bigint>;
  upload(onSigned: (id: string) => void): Promise<string>;
}
export interface StorageAdapter {
  address: string;
  balance(): Promise<bigint>;
  prepare(files: SiteFile[]): Promise<PreparedUpload>;
  fundingAddress(): Promise<`0x${string}`>;
  submitFunding(hash: string): Promise<void>;
}
export interface StorageSDK {
  connect(wallet: WalletClient, guard: () => Promise<void>): Promise<StorageAdapter>;
}
export interface PublishRecord {
  version: 1;
  fingerprint: string;
  address: string;
  manifestId: string;
  manifest: FolderManifest;
  digests: Record<string, AssetDigest>;
  bundleId?: string;
  uploaded: boolean;
  verified: boolean;
  timestamp: number;
}
export interface FundingRecord { address: string; amount: string; target: string; hash?: string; status: 'pending' | 'uncertain' | 'credited'; timestamp: number }
