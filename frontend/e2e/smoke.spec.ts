import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, CHAT_TITLE, STATIC_ORIGIN } from './playwright.config';

const problems: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener('error', (event) =>
          console.error(`Worker error (${String(args[0])}): ${event.message}`),
        );
      }
    };
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  // API responses (e.g. 400 for a repo without a remote) also log "Failed to load
  // resource"; static-origin failures are caught by the response listeners below.
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(STATIC_ORIGIN)) {
      problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(STATIC_ORIGIN) && response.status() >= 400) {
      problems.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('production desktop bundle loads chat, editor and diff view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByLabel('Email address').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // `/` reopens the newest thread, so the URL may already be the chat's
  await page.getByText(CHAT_TITLE).first().click();
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

  const editorToggle = page.getByRole('button', { name: 'Toggle Editor view' });
  await editorToggle.click();
  await expect(editorToggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open file tree' }).first().click();
  await page.getByRole('treeitem', { name: /hello\.ts/ }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('hello, smoke');

  const diffWorker = page.waitForEvent('worker', {
    predicate: (worker) => worker.url().startsWith(`${STATIC_ORIGIN}/assets/worker-`),
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Toggle Diff view' }).click();
  await diffWorker;
  const diff = page.locator('diffs-container');
  await expect(diff).toContainText('hello, smoke');
  await expect(diff.locator('[style*="--diffs-token-keyword"]').first()).toBeVisible();
});
