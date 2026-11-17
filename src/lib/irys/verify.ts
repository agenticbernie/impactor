import { readBounded, sha256 } from './site';
import { SITE_GATEWAY, validId, validManifest, websiteUrl } from './journal';
import type { PublishRecord } from './types';

/** CDN labels are not proof of content. Every accepted response is size/hash checked. */
export function allowedDelivery(url: string, record: PublishRecord, name: string, root = false): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
    const assetId = record.manifest.paths[name]?.id;
    const path = u.pathname.replace(/\/$/, '');
    const expected = root ? [`/${record.manifestId}`, `/${assetId}`] : [`/${record.manifestId}/${name}`, `/${assetId}`];
    return (u.origin === SITE_GATEWAY || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.datasprite-cdn\.com$/.test(u.hostname)) && expected.includes(path);
  } catch { return false; }
}
export async function verifyWebsite(record: PublishRecord, fetcher: typeof fetch = fetch): Promise<void> {
  if (!validId(record.manifestId) || !validManifest(record.manifest)) throw new Error('Invalid retained manifest.');
  // Indexed manifests resolve to HTML. There is no documented raw bypass API.
  // Verify the effective manifest routing: root HTML AND every named asset path,
  // against local hashes of the exact uploaded bytes. Do not claim raw JSON fetched.
  const checks = [{ name: 'index.html', root: true }, ...Object.keys(record.manifest.paths).map(name => ({ name, root: false }))];
  for (const { name, root } of checks) {
    const expected = record.digests[name];
    if (!expected || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('Missing or invalid local content digest.');
    const url = `${websiteUrl(record.manifestId)}${root ? '' : `/${name}`}`;
    const response = await fetcher(url, { mode: 'cors', redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!allowedDelivery(response.url, record, name, root)) { await response.body?.cancel(); throw new Error('Unrecognized gateway/CDN delivery URL. ID retained; verification pending.'); }
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (name === 'index.html' && type !== 'text/html') { await response.body?.cancel(); throw new Error('Gateway is not serving executable HTML. Verification pending.'); }
    const bytes = await readBounded(response, expected.bytes);
    if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256) throw new Error(`Gateway content mismatch for ${name}. ID retained; do not upload again.`);
  }
}
