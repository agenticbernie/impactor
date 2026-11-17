import { describe, expect, it, vi } from 'vitest';
import { allowedDelivery, verifyWebsite } from './verify';
import { sha256 } from './site';
import { validId, websiteUrl } from './journal';
import type { PublishRecord } from './types';
const id = 'a'.repeat(43), assetId = 'b'.repeat(43);
async function fixture() {
  const text = 'known website bytes';
  const bytes = new TextEncoder().encode(text);
  const digests = Object.fromEntries(['index.html', 'app.js', 'app.css', 'project.json', 'LICENSES.txt'].map(name => [name, { bytes: bytes.length, sha256: '' }]));
  for (const digest of Object.values(digests)) digest.sha256 = await sha256(bytes);
  const record: PublishRecord = { version: 1, address: `0x${'1'.repeat(40)}`, fingerprint: 'c'.repeat(64), manifestId: id, manifest: { manifest: 'irys/paths', version: '0.1.0', index: { path: 'index.html' }, paths: Object.fromEntries(Object.keys(digests).map(name => [name, { id: assetId }])) }, digests, uploaded: true, verified: false, timestamp: 0 };
  const fetcher = vi.fn<typeof fetch>(async input => { const r = new Response(text, { headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: String(input) }); return r; });
  return { record, fetcher };
}
describe('bounded content verification', () => {
  it.each(['../x', 'https://evil.test', `${id}/x`, `${id}\n`, 'a'.repeat(42)])('rejects unsafe ID %s', input => { expect(validId(input)).toBe(false); expect(() => websiteUrl(input)).toThrow(); });
  it('requires canonical base58 for exactly 32 decoded bytes, including 43/44-character IDs', () => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const encode = (value: bigint) => { let out = ''; while (value) { out = alphabet[Number(value % 58n)] + out; value /= 58n; } return out; };
    for (const value of [1n << 248n, (1n << 256n) - 1n]) {
      const encoded = encode(value); expect([43, 44]).toContain(encoded.length); expect(validId(encoded)).toBe(true);
      let decoded = 0n; for (const ch of encoded) decoded = decoded * 58n + BigInt(alphabet.indexOf(ch)); expect(encode(decoded)).toBe(encoded);
    }
    expect(validId('1'.repeat(32))).toBe(true);
    for (const input of ['1'.repeat(31), '1'.repeat(33), encode(1n << 256n), `0${id.slice(1)}`, `O${id.slice(1)}`, `I${id.slice(1)}`, `l${id.slice(1)}`, `_${id.slice(1)}`, `-${id.slice(1)}`, `${id}%`, `${id}?`, `${id}#`]) expect(validId(input)).toBe(false);
  });
  it('checks root HTML and all five routed files, not just a 200 or HEAD', async () => {
    const { record, fetcher } = await fixture(); await verifyWebsite(record, fetcher); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher).toHaveBeenCalledWith(`https://gateway.irys.xyz/${id}/project.json`, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });
  it('rejects 200 wrong bytes and misleading MIME types', async () => {
    const { record, fetcher } = await fixture();
    fetcher.mockImplementationOnce(async input => { const r = new Response('wrong bytes', { headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: String(input) }); return r; });
    await expect(verifyWebsite(record, fetcher)).rejects.toThrow(/mismatch/);
    fetcher.mockImplementationOnce(async input => { const r = new Response('known website bytes', { headers: { 'content-type': 'application/json' } }); Object.defineProperty(r, 'url', { value: String(input) }); return r; });
    await expect(verifyWebsite(record, fetcher)).rejects.toThrow(/HTML/);
  });
  it('restricts redirects to documented CDN and known transaction/path semantics', async () => {
    const { record } = await fixture();
    expect(allowedDelivery(`https://sandbox.node.datasprite-cdn.com/${assetId}`, record, 'app.js')).toBe(true);
    for (const url of [`https://datasprite-cdn.com.evil.test/${assetId}`, `https://evil.test/${id}/app.js`, `http://gateway.irys.xyz/${id}`, `https://x.datasprite-cdn.com/${'z'.repeat(43)}`, `https://user@gateway.irys.xyz/${id}`, `https://gateway.irys.xyz/${id}?x=1`]) expect(allowedDelivery(url, record, 'app.js')).toBe(false);
  });
});
