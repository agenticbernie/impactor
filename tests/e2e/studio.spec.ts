import { test, expect } from '@playwright/test';

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
