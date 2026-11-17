import type { FolderManifest, FundingRecord, PublishRecord } from './types';
export const SITE_GATEWAY = 'https://gateway.irys.xyz';
export const JOURNAL_KEY = 'impactor.publish.v1';
export const FUNDING_KEY = 'impactor.funding.v1';
// Current pinned Irys SDK uses base58(SHA-256(signature)), not legacy base64url.
export function validId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length < 32 || id.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(id)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const char of id) value = value * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0; while (value > 0n) { bytes++; value >>= 8n; }
  const leadingZeros = id.match(/^1*/)?.[0].length ?? 0;
  return bytes + leadingZeros === 32;
}
export function websiteUrl(id: string): string { if (!validId(id)) throw new Error('Invalid website ID.'); return `${SITE_GATEWAY}/${id}`; }
export function validManifest(input: unknown): input is FolderManifest {
  if (!input || typeof input !== 'object') return false;
  const m = input as FolderManifest;
  return m.manifest === 'irys/paths' && m.version === '0.1.0' && m.index?.path === 'index.html' && !!m.paths && Object.keys(m.paths).sort().join(',') === 'LICENSES.txt,app.css,app.js,index.html,project.json' && Object.values(m.paths).every(item => item && validId(item.id));
}
export function readPublications(): PublishRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is PublishRecord => r?.version === 1 && validId(r.manifestId) && validManifest(r.manifest) && typeof r.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(r.fingerprint) && /^0x[a-fA-F0-9]{40}$/.test(r.address) && (!r.bundleId || validId(r.bundleId)) && typeof r.digests === 'object' && r.digests && Object.keys(r.digests).sort().join(',') === Object.keys(r.manifest.paths).sort().join(',') && Object.values(r.digests).every(d => { const v = d as { bytes: number; sha256: string }; return Number.isSafeInteger(v?.bytes) && v.bytes > 0 && v.bytes <= 16 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(v.sha256); })).slice(-20);
  } catch { return []; }
}
export function savePublication(record: PublishRecord): void {
  const previous = readPublications().filter(r => r.manifestId !== record.manifestId);
  localStorage.setItem(JOURNAL_KEY, JSON.stringify([...previous, record].slice(-20)));
}
export function readFunding(address: string): FundingRecord | undefined {
  try {
    const data = JSON.parse(localStorage.getItem(FUNDING_KEY) || '{}') as Record<string, FundingRecord>;
    const r = data[address.toLowerCase()];
    if (r && r.address.toLowerCase() === address.toLowerCase() && /^\d+$/.test(r.amount) && /^0x[a-fA-F0-9]{40}$/.test(r.target) && (!r.hash || /^0x[a-fA-F0-9]{64}$/.test(r.hash)) && ['pending', 'uncertain', 'credited'].includes(r.status)) return r;
  } catch { /* Browser storage is best-effort for reads, mandatory before spending. */ }
}
export function saveFunding(address: string, record?: FundingRecord): void {
  let previous: Record<string, FundingRecord> = {};
  try { previous = JSON.parse(localStorage.getItem(FUNDING_KEY) || '{}'); } catch { /* Restore a valid journal. */ }
  if (record) previous[address.toLowerCase()] = record; else delete previous[address.toLowerCase()];
  localStorage.setItem(FUNDING_KEY, JSON.stringify(previous));
}
