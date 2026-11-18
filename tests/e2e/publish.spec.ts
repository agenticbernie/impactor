import { test, expect } from '@playwright/test';

test('publish quote uses real browser SDK without implicit signatures and survives close/reopen', async ({ page }) => {
  test.setTimeout(90_000);
  const account = `0x${'1'.repeat(40)}`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(account => {
    const calls: string[] = [];
    Object.defineProperty(window, '__publishCalls', { value: calls });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0xa869';
        if (method === 'wallet_requestPermissions') return [];
        if (method === 'eth_sendTransaction') throw Object.assign(new Error('User rejected funding'), { code: 4001 });
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on() {}, removeListener() {},
    } });
  }, account);
  await page.route('https://api.avax-test.network/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xa869' }) }));
  const posts: string[] = [];
  await page.route('https://devnet.irys.xyz/**', route => {
    const request = route.request();
    if (request.method() !== 'GET') { posts.push(request.url()); return route.abort(); }
    const url = request.url();
    return route.fulfill({ contentType: 'application/json', body: url.endsWith('/info') ? JSON.stringify({ addresses: { avalanche: account } }) : url.includes('/price/') ? '1000000000000000' : JSON.stringify({ balance: '0' }) });
  });
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const walletChooser = page.getByRole('dialog', { name: 'Choose a wallet', exact: true });
  await walletChooser.getByRole('button', { name: 'Injected', exact: true }).click();
  await expect(walletChooser).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Publish a Fuji website' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __publishCalls: string[] }).__publishCalls.filter(m => m.includes('sign') || m.startsWith('eth_send')))).toEqual([]);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Prepare snapshot & quote (no signature)', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review storage quote' })).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText('0.001 AVAX', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __publishCalls: string[] }).__publishCalls.filter(m => m.includes('sign') || m.startsWith('eth_send')))).toEqual([]);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review storage quote' })).toBeVisible();
  await dialog.getByRole('button', { name: '1. Fund 0.001 test AVAX + gas', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/rejected/i);
  expect(await page.evaluate(() => (window as unknown as { __publishCalls: string[] }).__publishCalls.filter(m => m.startsWith('eth_send')))).toEqual(['eth_sendTransaction']);
  expect(posts).toEqual([]);
  await page.screenshot({ path: '/tmp/impactor-publish-dialog.png', fullPage: true });
  expect(errors).toEqual([]);
});
