import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createBlock, createProject } from '@/lib/schema';
import { validId } from '@/lib/irys/journal';
import { prepareSite } from '@/lib/irys/site';

it('builds a validated, escaped website package with no hosted-runtime dependency', async () => {
  const project = createProject('</script><script>globalThis.INJECTED=1</script>', 'blank');
  const site = await prepareSite(project, async url => new Response(await readFile(`public${String(url)}`, 'utf8')));
  const html = site.files.find(file => file.name === 'index.html')!.text;
  expect(html).not.toContain(project.name);
  expect(html).toContain('\\u003c/script\\u003e');
  expect(html).not.toContain('/_next/');
  expect(site.files.map(file => file.name).sort()).toEqual(['LICENSES.txt', 'app.css', 'app.js', 'index.html', 'project.json']);
  expect(JSON.parse(site.files.find(file => file.name === 'project.json')!.text)).toEqual(project);
  await expect(prepareSite({ ...project, schemaVersion: 999 } as never)).rejects.toThrow(/validation/);
  await expect(prepareSite({ ...project, network: { ...project.network, chainId: 43114 } })).rejects.toThrow();
  await expect(prepareSite(project, async () => new Response('corrupt'))).rejects.toThrow(/corrupt/);
});

it.skipIf(process.env.IMPACTOR_VERIFY_STATIC !== '1')('runs the actual runtime on an independent static host and prepares the real SDK offline without signatures', async () => {
  const project = createProject('Independent static dApp', 'token');
  const input = project.uiTree.children!.find(block => block.type === 'Input')!;
  const button = createBlock('Button'); button.props.label = 'Run static workflow'; project.uiTree.children!.push(button);
  project.workflows = { nodes: [
    { id: 'trigger', type: 'ui_trigger', label: 'Click', position: { x: 0, y: 0 }, config: { blockId: button.id, event: 'onClick' } },
    { id: 'feedback', type: 'ui_feedback', label: 'Feedback', position: { x: 100, y: 0 }, config: { message: `Static received {{inputs.${input.id}.value}}` } },
  ], edges: [{ id: 'edge', source: 'trigger', target: 'feedback' }] };
  const site = await prepareSite(project, async url => new Response(await readFile(`public${String(url)}`, 'utf8')));
  const sdk = await readFile('public/publish-runtime/sdk.js', 'utf8');
  const server = createServer((req, res) => {
    const file = req.url === '/sdk.js' ? { type: 'text/javascript', text: sdk } : site.files.find(file => file.name === req.url?.split('/').pop()) || site.files.find(file => file.name === 'index.html');
    res.writeHead(200, { 'content-type': file!.type }); res.end(file!.text);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Static host failed');
  const origin = `http://127.0.0.1:${address.port}`;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, ...(process.env.IMPACTOR_CHROMIUM_PATH ? { executablePath: process.env.IMPACTOR_CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage(); const errors: string[] = []; const outside: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => { if (route.request().url().startsWith(origin)) await route.continue(); else { outside.push(route.request().url()); await route.abort(); } });
    await page.addInitScript(() => { const requests: string[] = []; Object.defineProperty(window, '__walletRequests', { value: requests }); Object.defineProperty(window, 'ethereum', { value: { isMetaMask: true, request: async ({ method }: { method: string }) => { requests.push(method); return method === 'eth_accounts' ? [] : method === 'eth_chainId' ? '0xa869' : null; }, on() {}, removeListener() {} } }); });
    // No trailing slash, nested gateway prefix, and index-file paths all work.
    for (const path of ['/manifest-id', '/manifest-id/', '/manifest-id/index.html']) {
      await page.goto(origin + path);
      await page.getByRole('heading', { name: 'Your token dashboard', exact: true }).waitFor();
      await page.getByLabel('Recipient address', { exact: true }).fill('independent');
      await page.getByRole('button', { name: 'Run static workflow', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Static received independent' }).waitFor();
    }
    expect(await page.evaluate(() => (window as unknown as { __walletRequests: string[] }).__walletRequests.filter(method => method === 'eth_requestAccounts' || method.includes('sign') || method.startsWith('wallet_') || method.startsWith('eth_send')))).toEqual([]);
    expect(outside).toEqual([]); expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/impactor-static-runtime.png', fullPage: true });
    // Actual compiled SDK, mocked public endpoints; never a real wallet or upload.
    await page.route('https://api.avax-test.network/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xa869' }) }));
    await page.route('https://devnet.irys.xyz/**', route => {
      if (route.request().method() !== 'GET' || !route.request().url().includes('/price/')) throw new Error('Unexpected storage network side effect');
      return route.fulfill({ contentType: 'application/json', body: '123456789' });
    });
    await page.addScriptTag({ url: origin + '/sdk.js' });
    const result = await page.evaluate(async files => {
      const calls: string[] = [];
      const wallet = { account: { address: `0x${'1'.repeat(40)}` }, getAddresses: async () => [`0x${'1'.repeat(40)}`], getChainId: async () => 43113, signTypedData: async () => { calls.push('sign'); throw new Error('User rejected test signature'); }, sendTransaction: async () => { calls.push('pay'); throw new Error('Forbidden'); } };
      const sdk = (window as unknown as { ImpactorStorageSDK: { connect: (wallet: unknown, guard: () => Promise<void>) => Promise<import('@/lib/irys/types').StorageAdapter> } }).ImpactorStorageSDK;
      const adapter = await sdk.connect(wallet, async () => {});
      const prepared = await adapter.prepare(files);
      const price = await prepared.price();
      const before = [...calls]; let rejection = '';
      try { await prepared.upload(() => { throw new Error('No upload should be attempted'); }); } catch (error) { rejection = String(error); }
      return { manifest: prepared.manifest, bytes: prepared.bytes, manifestId: prepared.manifestId, price: price.toString(), before, calls, rejection };
    }, site.files);
    expect(result.manifest.manifest).toBe('irys/paths'); expect(result.manifest.index.path).toBe('index.html'); expect(validId(result.manifestId)).toBe(true);
    expect(result.bytes).toBeGreaterThan(site.bytes); expect(result.price).toBe('123456789'); expect(result.before).toEqual([]); expect(result.calls).toEqual(['sign']); expect(result.rejection).toMatch(/rejected test signature/); expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 180_000);
