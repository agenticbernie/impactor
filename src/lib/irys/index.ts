import { parseProjectJson } from '@/lib/schema';
import type { ImpactorProjectSchema } from '@/lib/schema/types';

export const SNAPSHOT_MAX_BYTES = 1024 * 1024;
export const SNAPSHOT_TIMEOUT_MS = 15_000;
export const IRYS_GATEWAY = process.env.NEXT_PUBLIC_IRYS_GATEWAY || 'https://gateway.irys.xyz';

export const publicationCapability = {
  enabled: false,
  status: 'unverified',
  reason: 'Publishing is disabled: browser SDK/wallet compatibility, payment chain and asset, fees/funding, upload completion, and retrieval guarantees have not been verified.',
  reasons: [
    'Current Irys browser SDK and Core/MetaMask wallet compatibility are unverified.',
    'Supported storage-payment chain, asset, fees and funding flow are unverified; Fuji test AVAX support is not assumed.',
    'Upload completion semantics, identifier format, payload limits, CORS and current storage/retrieval guarantees are unverified.',
  ],
  retrieval: 'experimental',
} as const;

export type SnapshotResult =
  | { status: 'ready'; project: ImpactorProjectSchema }
  | { status: 'invalid' | 'unavailable' | 'unsupported-schema' | 'unsupported-network'; message: string };

/** Experimental legacy data-item ID format. Never accepts URLs or path fragments. */
export function isValidSnapshotId(id: string): boolean {
  return id.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(id);
}

function snapshotUrl(id: string): URL {
  const gateway = new URL(IRYS_GATEWAY);
  if (gateway.protocol !== 'https:' || gateway.username || gateway.password || gateway.search || gateway.hash) {
    throw new Error('The configured snapshot gateway must be an HTTPS root without credentials, query or fragment.');
  }
  gateway.pathname = `${gateway.pathname.replace(/\/+$/, '')}/${id}`;
  return gateway;
}

/** Browser retrieval only. Route data never controls the gateway or fetch origin. */
export async function loadPublishedProject(
  id: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<SnapshotResult> {
  if (!isValidSnapshotId(id)) return { status: 'invalid', message: 'Invalid snapshot identifier. Expected a 43-character base64url data-item ID, not a URL.' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetcher ?? fetch)(snapshotUrl(id).href, {
      signal: controller.signal,
      mode: 'cors',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      return { status: 'unavailable', message: 'The fixed gateway could not retrieve this snapshot. Check the identifier or retry later.' };
    }
    const length = response.headers.get('content-length');
    if (length && Number(length) > SNAPSHOT_MAX_BYTES) {
      await response.body?.cancel();
      return { status: 'invalid', message: 'Snapshot exceeds the 1 MiB size limit.' };
    }
    if (!response.body) return { status: 'invalid', message: 'The gateway returned an empty snapshot.' };
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (true) {
      if (controller.signal.aborted) throw new Error('Retrieval aborted');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > SNAPSHOT_MAX_BYTES) {
        await reader.cancel();
        return { status: 'invalid', message: 'Snapshot exceeds the 1 MiB size limit.' };
      }
      try { text += decoder.decode(value, { stream: true }); } catch {
        return { status: 'invalid', message: 'Snapshot is not valid UTF-8 JSON.' };
      }
    }
    try { text += decoder.decode(); } catch {
      return { status: 'invalid', message: 'Snapshot is not valid UTF-8 JSON.' };
    }
    let input: unknown;
    try { input = JSON.parse(text); } catch {
      return { status: 'invalid', message: 'Snapshot is not valid JSON.' };
    }
    if (typeof input === 'object' && input !== null && 'schemaVersion' in input && input.schemaVersion !== 1) {
      return { status: 'unsupported-schema', message: 'This snapshot uses an unsupported schema version. No automatic migration or execution was attempted.' };
    }
    const result = parseProjectJson(text);
    if (!result.success) return { status: 'invalid', message: `Snapshot validation failed: ${result.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join('; ')}` };
    if (result.project.network.chainId !== 43113) return { status: 'unsupported-network', message: 'This snapshot targets an unsupported execution network. P0 runtime supports Avalanche Fuji (43113) only.' };
    return { status: 'ready', project: result.project };
  } catch {
    return { status: 'unavailable', message: controller.signal.aborted
      ? 'Snapshot retrieval was cancelled or exceeded the 15-second time limit. You may retry without uploading or paying again.'
      : 'Snapshot retrieval failed. The gateway may be unavailable, redirecting, or not permit browser retrieval (CORS). Retrieval support is experimental.' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (reader) {
      try { await reader.cancel(); } catch { /* The network stream may already be closed. */ }
      reader.releaseLock();
    }
  }
}
