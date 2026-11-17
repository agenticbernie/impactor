import { canonicalizeProject, validateProject } from '@/lib/schema';
import type { ImpactorProjectSchema } from '@/lib/schema/types';
import build from './generated-static.json';
import type { SiteFile, SitePackage } from './types';

export const MAX_SITE_BYTES = 16 * 1024 * 1024;
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function snapshotText(project: ImpactorProjectSchema): string {
  const result = validateProject(project);
  if (!result.success) throw new Error('Resolve project validation errors before publishing.');
  if (result.project.network.chainId !== 43113) throw new Error('Publishing supports Avalanche Fuji (43113) only.');
  const text = canonicalizeProject(result.project);
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Project exceeds 1 MiB.');
  return text;
}
export async function readBounded(response: Response, max: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error('File is unavailable or not indexed yet.');
  if (Number(response.headers.get('content-length')) > max) { await response.body.cancel(); throw new Error('File exceeds its expected size.'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > max) throw new Error('File exceeds its expected size.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function prepareSite(project: ImpactorProjectSchema, fetcher: typeof fetch = fetch): Promise<SitePackage> {
  const snapshot = snapshotText(project);
  const files: SiteFile[] = [];
  for (const [name, expected] of Object.entries(build.files)) {
    const response = await fetcher(`/publish-runtime/${name}`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000), cache: 'no-cache' });
    const bytes = await readBounded(response, expected.bytes);
    if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256) throw new Error('Static runtime changed or is corrupt. Reload Impactor before preparing.');
    files.push({ name, type: expected.type, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
  }
  const js = files.find(file => file.name === 'app.js')!.text;
  const css = files.find(file => file.name === 'app.css')!.text;
  // Inert JSON is escaped for HTML parsing; React renders authored strings as data.
  // Inline executable assets avoid gateway root/trailing-slash/CDN path ambiguity.
  // Identical standalone JS/CSS/project files remain available in the manifest.
  const inert = snapshot.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Avalanche Fuji dApp</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#182237}button,input{font:inherit}@media(prefers-color-scheme:dark){body{background:#101724;color:#eef2fa}}${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><main id="app">Loading application…</main><noscript>This dApp requires JavaScript.</noscript><script type="application/json" id="project-data">${inert}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  files.push({ name: 'project.json', type: 'application/json', text: `${snapshot}\n` }, { name: 'index.html', type: 'text/html', text: html });
  const digests: SitePackage['digests'] = {};
  let bytes = 0;
  for (const file of files) { const data = new TextEncoder().encode(file.text); bytes += data.length; digests[file.name] = { bytes: data.length, sha256: await sha256(data) }; }
  if (bytes > MAX_SITE_BYTES) throw new Error('Website exceeds the 16 MiB publishing limit.');
  return { files, digests, bytes, fingerprint: await sha256(new TextEncoder().encode(snapshot)) };
}
