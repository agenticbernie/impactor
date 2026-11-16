import { describe, expect, it, vi } from 'vitest';
import { createProject, MAINNET_NETWORK } from '@/lib/schema';
import { isValidSnapshotId, loadPublishedProject, publicationCapability, SNAPSHOT_MAX_BYTES } from '@/lib/irys';

const id = 'a'.repeat(43);
function responseFetcher(body: string, init?: ResponseInit) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(body, init));
}

describe('bounded experimental published snapshots', () => {
  it('keeps paid publication disabled with explicit unresolved capabilities', () => {
    expect(publicationCapability.enabled).toBe(false);
    expect(publicationCapability.reason).toMatch(/payment chain/);
    expect(publicationCapability.retrieval).toBe('experimental');
  });

  it.each(['', '../project', 'https://evil.test/a', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}/`, `${'a'.repeat(42)}%`, `${'a'.repeat(43)}\n`])('rejects invalid identifier %j without fetching', async (input) => {
    const fetcher = responseFetcher('{}');
    expect(isValidSnapshotId(input)).toBe(false);
    expect((await loadPublishedProject(input, { fetcher })).status).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads a validated schema only from the configured gateway with no credentials or redirects', async () => {
    const project = createProject('Snapshot', 'blank');
    const fetcher = responseFetcher(JSON.stringify(project));
    expect(await loadPublishedProject(id, { fetcher })).toEqual({ status: 'ready', project });
    expect(fetcher).toHaveBeenCalledWith(`https://gateway.irys.xyz/${id}`, expect.objectContaining({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });

  it('rejects a declared oversized body without parsing it', async () => {
    const fetcher = responseFetcher('{}', { headers: { 'content-length': String(SNAPSHOT_MAX_BYTES + 1) } });
    expect(await loadPublishedProject(id, { fetcher })).toMatchObject({ status: 'invalid', message: expect.stringContaining('1 MiB') });
  });

  it('enforces the streaming byte limit even when Content-Length is missing or dishonest', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SNAPSHOT_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'content-length': '2' } }));
    expect((await loadPublishedProject(id, { fetcher })).status).toBe('invalid');
    expect(cancelled).toBe(true);
  });

  it('distinguishes gateway failure, unsupported schema, invalid JSON and unsupported network', async () => {
    expect((await loadPublishedProject(id, { fetcher: responseFetcher('', { status: 404 }) })).status).toBe('unavailable');
    expect((await loadPublishedProject(id, { fetcher: responseFetcher('{"schemaVersion":999}') })).status).toBe('unsupported-schema');
    expect((await loadPublishedProject(id, { fetcher: responseFetcher('<script>alert(1)</script>') })).status).toBe('invalid');
    const project = createProject('Other network', 'blank');
    project.network = MAINNET_NETWORK;
    expect((await loadPublishedProject(id, { fetcher: responseFetcher(JSON.stringify(project)) })).status).toBe('unsupported-network');
  });

  it('rejects malicious executable block properties and future action types', async () => {
    const project = createProject('Malicious', 'blank');
    project.uiTree.props = { dangerouslySetInnerHTML: '<img onerror=alert(1)>' };
    expect((await loadPublishedProject(id, { fetcher: responseFetcher(JSON.stringify(project)) })).status).toBe('invalid');
  });

  it('times out a fetch and reports unavailability rather than invalid data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    expect(await loadPublishedProject(id, { fetcher, timeoutMs: 5 })).toMatchObject({ status: 'unavailable', message: expect.stringContaining('time limit') });
  });

  it('rejects malformed UTF-8 bytes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe])));
    expect((await loadPublishedProject(id, { fetcher })).status).toBe('invalid');
  });
});
