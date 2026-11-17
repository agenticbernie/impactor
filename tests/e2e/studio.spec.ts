import { test, expect } from '@playwright/test';
import erc20 from '../../src/lib/web3/artifacts/FixedSupplyToken.json';
import erc721 from '../../src/lib/web3/artifacts/OwnerMintNFT.json';

async function openStudio(page: import('@playwright/test').Page) {
  await page.goto('/studio');
  await expect(page.getByRole('navigation', { name: 'Studio workspace' })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Draft saved locally');
}

test('landing leads into a working, wallet-free Studio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await page.locator('a[href="/studio"]').first().click();
  await expect(page.getByRole('navigation', { name: 'Studio workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Edit mode · no transactions', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('edit, undo, redo and autosave survive reload', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('group', { name: 'Heading: Your token dashboard', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Block properties' });
  await inspector.getByLabel('Text', { exact: true }).fill('An Avalanche app of my own');
  await expect(page.getByRole('heading', { name: 'An Avalanche app of my own' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'An Avalanche app of my own' })).toBeVisible();
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'An Avalanche app of my own' })).toBeVisible();
});

test('click-only block authoring and semantic workflow feedback', async ({ page }) => {
  await openStudio(page);
  await page.locator('.palette-item').filter({ hasText: /^Button$/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Block properties' });
  await inspector.getByLabel('Label', { exact: true }).fill('Say hello');
  await page.getByRole('button', { name: 'Duplicate block', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Button: Say hello', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete block', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Button: Say hello', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await page.locator('.action-palette-item').filter({ hasText: 'Click trigger' }).click();
  await page.getByLabel('When this button is clicked').selectOption({ label: 'Say hello' });
  await page.locator('.action-palette-item').filter({ hasText: 'Show feedback' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Hello from my workflow');
  await page.getByRole('button', { name: 'Step list', exact: true }).click();
  await expect(page.locator('.workflow-step-list ol li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Interface', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Interactive preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Say hello', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Say hello', exact: true }).click();
  await expect(page.getByText('Hello from my workflow', { exact: true })).toBeVisible();
});

test('export downloads real source and publication remains honest', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Export code', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source ZIP', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.failure()).toBeNull();
  await expect(page.getByText(/Source exported\. Follow the README/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Publishing is not available in this release.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Nothing has been uploaded or charged/)).toBeVisible();
});

test('malformed import preserves the current project', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'View project JSON', exact: true }).click();
  await page.getByLabel('Import project JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.getByRole('alert')).toContainText('Unable to complete this action');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
});

test('mobile landing and runtime do not overflow the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await openStudio(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Interactive preview', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('published loader rejects malformed identifiers without connecting a wallet', async ({ page }) => {
  const signingCalls: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: async () => { throw new Error('Wallet requests are not expected on load'); } } });
  });
  page.on('pageerror', error => signingCalls.push(error.message));
  await page.goto('/dapp/invalid');
  await expect(page.getByText(/invalid|unsupported|unavailable/i).first()).toBeVisible();
  expect(signingCalls.filter(message => message.includes('Wallet requests are not expected'))).toEqual([]);
});

test('confirmed deployment keeps Contracts and Preview on one wallet session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const account = '0x0000000000000000000000000000000000000001';
  const contractAddress = '0x0000000000000000000000000000000000000002';
  const hash = `0x${'ab'.repeat(32)}`;
  await page.addInitScript(({ account, hash }) => {
    const calls: string[] = [];
    Object.defineProperty(window, '__walletCalls', { value: calls });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0xa869';
        if (method === 'wallet_requestPermissions') return [];
        if (method === 'eth_sendTransaction') return hash;
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on() {}, removeListener() {},
    } });
  }, { account, hash });
  // Controlled RPC/receipt: exercise the deployment UI without spending test AVAX.
  await page.route('https://api.avax-test.network/ext/bc/C/rpc', async route => {
    const results: Record<string, unknown> = {
      eth_chainId: '0xa869', eth_estimateGas: '0x100000', eth_getCode: '0x6000', eth_blockNumber: '0x1',
      eth_getTransactionReceipt: {
        transactionHash: hash, transactionIndex: '0x0', blockHash: `0x${'cd'.repeat(32)}`,
        blockNumber: '0x1', from: account, to: null, contractAddress, cumulativeGasUsed: '0x100000',
        gasUsed: '0x100000', effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`,
        status: '0x1', type: '0x2',
      },
    };
    const respond = (call: { id: number; method: string }) => {
      if (!Object.hasOwn(results, call.method)) throw new Error(`Unexpected RPC request: ${call.method}`);
      return { jsonrpc: '2.0', id: call.id, result: results[call.method] };
    };
    const body = route.request().postDataJSON();
    await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
  });

  await openStudio(page);
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Contract configuration' });
  await manager.getByRole('button', { name: 'Connect Injected', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Deploy template', exact: true }).click();
  await manager.getByLabel('Token name', { exact: true }).fill('Regression token');
  await manager.getByLabel('Symbol', { exact: true }).fill('REG');
  await manager.getByLabel('Initial supply recipient', { exact: true }).fill(account);
  await manager.getByRole('button', { name: 'Simulate and review deployment', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
  await expect(manager.getByText('Project contracts (1)', { exact: true })).toBeVisible();
  await expect(manager.getByText('Deployment transaction · succeeded', { exact: true })).toBeVisible();
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Interface', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const runtime = page.getByRole('region', { name: 'Untitled project runtime' });
  await expect(runtime.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(2);
  await expect(runtime.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
  await runtime.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Connect Injected', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);
  expect(calls.filter(method => method === 'eth_sendTransaction')).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const artifact of [erc20, erc721]) {
  test(`downloads ABI JSON and registers the full ${artifact.name} artifact`, async ({ page }) => {
    await page.route('https://api.avax-test.network/ext/bc/C/rpc', async route => {
      const respond = (call: { id: number; method: string }) => {
        if (!['eth_chainId', 'eth_getCode'].includes(call.method)) throw new Error(`Unexpected RPC request: ${call.method}`);
        return { jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0xa869' : '0x6000' };
      };
      const body = route.request().postDataJSON();
      await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
    });
    await openStudio(page);
    await page.getByRole('button', { name: 'Contracts', exact: true }).click();
    const manager = page.getByRole('region', { name: 'Contract configuration' });
    await manager.getByRole('button', { name: 'Deploy template', exact: true }).click();
    await manager.locator('.rt-form select').selectOption(artifact.templateId);
    const downloading = page.waitForEvent('download');
    await manager.getByRole('button', { name: 'Download ABI JSON', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`${artifact.name}-abi.json`);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(artifact.abi);

    await manager.getByRole('button', { name: 'Import existing contract', exact: true }).click();
    await manager.getByLabel('Name', { exact: true }).fill(artifact.name);
    await manager.getByLabel('Contract address', { exact: true }).fill('0x0000000000000000000000000000000000000002');
    await manager.getByLabel('ABI JSON', { exact: true }).fill(JSON.stringify(artifact, null, 2));
    await manager.getByRole('button', { name: 'Inspect ABI functions', exact: true }).click();
    await expect(manager.getByRole('group', { name: 'Functions exposed to this project' })).toBeVisible();
    await manager.getByRole('button', { name: 'Verify and register contract', exact: true }).click();
    await expect(manager.getByText('Project contracts (1)', { exact: true })).toBeVisible();
    await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View project JSON', exact: true }).click();
    const project = JSON.parse(await page.locator('.source-view').innerText());
    expect(project.contracts[0].abi).toEqual(artifact.abi);
    expect(project.contracts[0].bytecode).toBeUndefined();
    expect(project.contracts[0].sources).toBeUndefined();
  });
}
