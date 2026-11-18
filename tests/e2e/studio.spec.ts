import { test, expect } from '@playwright/test';
import erc20 from '../../src/lib/web3/artifacts/FixedSupplyToken.json';
import erc721 from '../../src/lib/web3/artifacts/OwnerMintNFT.json';

const defaultAccount = '0x0000000000000000000000000000000000000001';

async function installStudioWallet(page: import('@playwright/test').Page, controlled = false) {
  await page.addInitScript(({ account, controlled }) => {
    if (window.ethereum) return;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    Object.defineProperty(window, '__emitWalletEvent', { value: (event: string, ...args: unknown[]) => listeners.get(event)?.forEach(listener => listener(...args)) });
    const calls: string[] = [];
    Object.defineProperty(window, '__connectionCalls', { value: calls });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (controlled && method === 'eth_requestAccounts') return new Promise<string[]>((resolve, reject) => {
          Object.defineProperty(window, '__settleConnection', { configurable: true, value: (succeed: boolean) => succeed ? resolve([account]) : reject(Object.assign(new Error('Raw private provider error'), { code: 4001 })) });
        });
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0xa869';
        if (method === 'wallet_requestPermissions') return [];
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on(event: string, listener: (...args: unknown[]) => void) { const registered = listeners.get(event) ?? new Set(); registered.add(listener); listeners.set(event, registered); }, removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    } });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
      info: { uuid: '350670db-19fa-4704-a166-e52e178b59d2', name: 'Studio Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'test.studio.wallet' },
      provider: window.ethereum,
    } }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, { account: defaultAccount, controlled });
}

async function connectStudioWallet(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a wallet', exact: true });
  // The named EIP-6963 fixture is preferred; custom deployment fixtures retain Injected.
  const choice = dialog.getByRole('list', { name: 'Detected wallets' }).getByRole('button').last();
  await expect(choice).toHaveText(/^(Studio Test Wallet|Injected)$/);
  await choice.click();
  await expect(dialog).toHaveCount(0);
}

async function openStudio(page: import('@playwright/test').Page) {
  await installStudioWallet(page);
  await page.goto('/studio');
  const gate = page.getByRole('main');
  if (await gate.getByText('Connect to access Studio.', { exact: true }).isVisible()) await connectStudioWallet(page);
  await expect(page.getByRole('navigation', { name: 'Studio workspace' })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Draft saved locally');
}

test('landing wallet entry and direct Studio gate require a deliberate connection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installStudioWallet(page);
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(1);
  await expect(page.getByText('Connection only — no Impactor account, signature, payment, or upload.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Connect a wallet to build/i })).toHaveAttribute('href', '/studio');
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Connect to access Studio.', exact: true })).toBeVisible();
  await expect(page.locator('[id="main-content"]')).toHaveCount(1);
  await connectStudioWallet(page);
  await expect(page.getByRole('navigation', { name: 'Studio workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Edit mode · no transactions', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('landing chooser discovers named browser wallets and restores keyboard focus', async ({ page }) => {
  await installStudioWallet(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Choose a wallet', exact: true });
  await expect(dialog.getByRole('button', { name: 'Studio Test Wallet', exact: true })).toBeVisible();
  await expect(dialog).toContainText('Wallets detected in this browser appear below.');
  expect(await page.evaluate(() => (window as unknown as { __connectionCalls: string[] }).__connectionCalls)).toEqual([]);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Studio Test Wallet', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await connectStudioWallet(page);
  await expect(page.getByText('0x0000…0001 · Chain 43113', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Studio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(trigger).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open Studio', exact: true })).toHaveCount(0);
});

test('no-provider browser still opens an empty chooser on landing and Studio at mobile width', async ({ page }) => {
  // A clean browser context with no EIP-6963 announcer and no legacy provider.
  // Do not installStudioWallet here: it would invalidate the empty-provider case.
  await page.addInitScript(() => Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 320, height: 640 });
  for (const route of ['/', '/studio']) {
    await page.goto(route);
    const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Choose a wallet', exact: true });
    await expect(dialog.getByText('No wallet detected.', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Detected wallets' }).getByRole('button')).toHaveCount(0);
    await expect(dialog.getByRole('button')).toHaveCount(1); // Only the close control.
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(304);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('chooser prevents duplicate pending requests, permits dismissal, and offers a safe retry', async ({ page }) => {
  await installStudioWallet(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/studio');
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a wallet', exact: true });
  const choice = dialog.getByRole('button', { name: 'Studio Test Wallet', exact: true });
  await choice.click();
  await expect(dialog.getByRole('status')).toContainText('Connecting to Studio Test Wallet');
  await expect(choice).toBeDisabled();
  for (const option of await dialog.getByRole('list', { name: 'Detected wallets' }).getByRole('button').all()) await expect(option).toBeDisabled();
  await choice.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(choice).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __settleConnection: (succeed: boolean) => void }).__settleConnection(false));
  await expect(dialog.getByRole('alert')).toHaveText('Wallet connection was not completed. Check your wallet and try again.');
  await expect(dialog).not.toContainText('Raw private provider error');
  await expect(choice).toBeEnabled();
  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await choice.click();
  await expect(dialog.getByRole('status')).toContainText('Connecting to Studio Test Wallet');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __settleConnection: (succeed: boolean) => void }).__settleConnection(true));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Studio workspace' })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __connectionCalls: string[] }).__connectionCalls);
  expect(calls.filter(method => method === 'eth_requestAccounts')).toHaveLength(2);
  expect(calls.filter(method => method.includes('sign') || method.startsWith('eth_send'))).toEqual([]);
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
  await expect(page.getByRole('heading', { name: 'Connect to access Studio.', exact: true })).toBeVisible();
  await connectStudioWallet(page);
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
  await expect(page.getByRole('heading', { name: 'Publish a Fuji website', exact: true })).toBeVisible();
  await expect(page.getByText('Public data. Temporary testnet storage.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare snapshot & quote (no signature)', exact: true })).toBeDisabled();
});

test('malformed import preserves the current project', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'View project JSON', exact: true }).click();
  await page.getByLabel('Import project JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.getByRole('alert')).toContainText('Unable to complete this action');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Your token dashboard', exact: true })).toBeVisible();
});

test('extension disconnect closes a destructive confirmation and preserves the local project', async ({ page }) => {
  await openStudio(page);
  const projectName = (await page.locator('.project-switcher').innerText()).trim();
  await page.locator('.project-switcher').click();
  const projectsDialog = page.getByRole('dialog', { name: 'Your local workspace' });
  await expect(projectsDialog).toBeVisible();
  await projectsDialog.getByRole('button', { name: `Delete ${projectName}` }).click();
  await expect(page.getByRole('dialog', { name: 'Delete local project?' })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __emitWalletEvent: (event: string, accounts: string[]) => void }).__emitWalletEvent('accountsChanged', []));

  await expect(page.getByRole('dialog', { name: 'Delete local project?' })).toHaveCount(0);
  const gate = page.locator('main#main-content');
  await expect(gate).toHaveCount(1);
  await expect(gate.getByRole('heading', { name: 'Connect to access Studio.', exact: true })).toBeVisible();
  await expect(gate.evaluate(element => !element.closest('[aria-hidden="true"], [inert]'))).resolves.toBe(true);
  await expect(page.getByRole('button', { name: 'Delete project', exact: true })).toHaveCount(0);

  await connectStudioWallet(page);
  await expect(page.locator('.project-switcher')).toContainText(projectName);
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
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Contract configuration' });
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
  const gateMain = page.locator('main#main-content');
  await expect(gateMain).toHaveCount(1);
  await expect(gateMain.getByRole('heading', { name: 'Connect to access Studio.', exact: true })).toBeVisible();
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(gateMain.evaluate(element => !element.closest('[aria-hidden="true"], [inert]'))).resolves.toBe(true);
  await connectStudioWallet(page);
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(manager.getByText('Project contracts (1)', { exact: true })).toBeVisible();
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
