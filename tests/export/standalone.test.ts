import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { createBlock, createProject } from '@/lib/schema';
import { exportProject } from '@/lib/exporter';

// Expensive, opt-in verification of the ZIP rather than the repository checkout:
// IMPACTOR_VERIFY_EXPORT=1 npx vitest run tests/export/standalone.test.ts
it.skipIf(process.env.IMPACTOR_VERIFY_EXPORT !== '1')('installs, checks, builds and runs an independently extracted export', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'impactor-export-verification-'));
  const app = path.join(scratch, 'app');
  await mkdir(app);
  const project = createProject('Independent exported app', 'token');
  const input = project.uiTree.children!.find(block => block.type === 'Input')!;
  const button = createBlock('Button');
  button.props.label = 'Show exported input';
  project.uiTree.children!.push(button);
  project.workflows = {
    nodes: [
      { id: 'export-trigger', type: 'ui_trigger', label: 'Export click', position: { x: 0, y: 0 }, config: { blockId: button.id, event: 'onClick' } },
      { id: 'export-feedback', type: 'ui_feedback', label: 'Export feedback', position: { x: 100, y: 0 }, config: { message: `Export received {{inputs.${input.id}.value}}` } },
    ],
    edges: [{ id: 'export-edge', source: 'export-trigger', target: 'export-feedback' }],
  };
  const archive = Buffer.from(await (await exportProject(project)).arrayBuffer());
  await writeFile(path.join(scratch, 'source.zip'), archive);
  const zip = await JSZip.loadAsync(archive);
  for (const entry of Object.values(zip.files)) {
    expect(entry.name.startsWith('/') || entry.name.split('/').includes('..')).toBe(false);
    if (entry.dir) continue;
    const destination = path.join(app, entry.name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await entry.async('nodebuffer'));
  }
  console.log(`Independent source ZIP and extracted application: ${scratch}`);
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  // npm exec forwards its one-off allow-scripts flag, which npm 11 rejects for
  // project installs. The install below still explicitly disables all scripts.
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  for (const args of [
    ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'],
    ['run', 'typecheck'], ['run', 'lint'], ['run', 'build'],
  ]) {
    console.log(`Standalone check: npm ${args.join(' ')}`);
    execFileSync('npm', args, { cwd: app, env, stdio: 'inherit', timeout: 600_000 });
  }

  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Cannot reserve a verification port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, [path.join(app, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: app, env, stdio: 'inherit' });
  try {
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Export server exited with ${server.exitCode}`);
      try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* Wait for the server to listen. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(ready).toBe(true);
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true, ...(process.env.IMPACTOR_CHROMIUM_PATH ? { executablePath: process.env.IMPACTOR_CHROMIUM_PATH } : {}) });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        const requests: string[] = [];
        Object.defineProperty(window, '__exportWalletRequests', { value: requests });
        Object.defineProperty(window, 'ethereum', { value: { isMetaMask: true, request: async ({ method }: { method: string }) => { requests.push(method); return method === 'eth_accounts' ? [] : method === 'eth_chainId' ? '0xa869' : null; }, on() {}, removeListener() {} } });
      });
      await page.goto(url);
      await page.getByRole('heading', { name: 'Your token dashboard', exact: true }).waitFor();
      await page.getByLabel('Recipient address', { exact: true }).fill('verified standalone input');
      await page.getByRole('button', { name: 'Show exported input', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Export received verified standalone input' }).waitFor();
      await page.getByRole('heading', { name: 'Run finished', exact: true }).waitFor();
      const requests = await page.evaluate(() => (window as unknown as { __exportWalletRequests: string[] }).__exportWalletRequests);
      expect(requests.filter(method => method === 'eth_requestAccounts' || method.startsWith('eth_send') || method.includes('sign') || method.startsWith('wallet_'))).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: path.join(scratch, 'export-runtime.png'), fullPage: true });
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  } finally {
    server.kill('SIGTERM');
    if (server.exitCode === null) await new Promise<void>(resolve => server.once('exit', () => resolve()));
  }
}, 1_500_000);
