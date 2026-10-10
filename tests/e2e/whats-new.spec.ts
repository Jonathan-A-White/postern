// tests/e2e/whats-new.spec.ts — mw-s061bg.3: What's new in a real 390 px browser: the Update ready banner names the
// waiting version and what is in it, What's new on it opens the lines, the sheet shows once after an update, and
// About shows the version with a What's new on GitHub link and no list of versions. Three screenshots, written by the
// spec (test-results/shots) and not committed. changelog.json is a fixture, routed in; the shipped one is a unit test's.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });

const RUNNING = (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version;
const WAITING = '99.1.0';
const CHANGELOG = [
  { version: WAITING, date: '2026-12-01', story: 'a', kind: 'new', text: 'Pin a message to the top.' },
  { version: WAITING, date: '2026-12-01', story: 'b', kind: 'new', text: 'Voice notes keep their place.' },
  { version: WAITING, date: '2026-12-01', story: 'c', kind: 'fixed', text: 'The list no longer jumps.' },
  { version: RUNNING, date: '2026-10-09', story: 'd', kind: 'new', text: 'Search finds beads.' },
  { version: '0.0.5', date: '2026-08-01', story: 'e', kind: 'fixed', text: 'An old fix.' },
];

async function routeChangelog(page: Page) {
  await page.route('**/changelog.json', (route) => route.fulfill({ json: CHANGELOG, headers: { 'cache-control': 'no-store' } }));
}

async function openUnlocked(page: Page, path: string) {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('need-card').first()).toBeVisible();
  await page.goto(path);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('the banner names the waiting version and what is in it, and What\'s new opens the lines', async ({ page, context }) => {
  await routeChangelog(page);
  let build = 1;
  await context.route('**/sw.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n// build ${build}\n`, headers: { ...response.headers(), 'cache-control': 'no-store' } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  build = 2;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Update ready, tap to reload' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`${WAITING} · 2 new, 1 fixed ·`)).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await shot(page, 'whats-new-banner');

  await page.getByRole('button', { name: "What's new" }).click();
  const sheet = page.getByRole('dialog', { name: "What's new" });
  await expect(sheet.getByText('Pin a message to the top.')).toBeVisible();
  await expect(sheet.getByText('The list no longer jumps.')).toBeVisible();
  await expect(sheet.getByText('Search finds beads.')).toHaveCount(0);
  const box = await sheet.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'whats-new-sheet');
});

test('the sheet shows once after an update', async ({ page }) => {
  await routeChangelog(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('postern.lastSeenVersion')) localStorage.setItem('postern.lastSeenVersion', '0.0.1');
  });
  await openUnlocked(page, '/?v=me');
  const sheet = page.getByRole('dialog', { name: "What's new" });
  await expect(sheet.getByText('Search finds beads.')).toBeVisible();
  await expect(sheet.getByText('Pin a message to the top.')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Me', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('About has no list of versions and no Check for updates, and the version has a What\'s new on GitHub link', async ({ page }) => {
  await routeChangelog(page);
  await page.addInitScript((v) => localStorage.setItem('postern.lastSeenVersion', v), RUNNING);
  await openUnlocked(page, '/?v=about');
  const section = page.getByRole('region', { name: 'Version' });
  await expect(section.getByText(RUNNING, { exact: true })).toBeVisible();
  const link = section.getByRole('link', { name: "What's new on GitHub" });
  await expect(link).toHaveAttribute('href', 'https://github.com/Jonathan-A-White/postern/blob/main/CHANGELOG.md');
  await expect(page.getByText(/check for updates/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: WAITING })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '0.0.5' })).toHaveCount(0);
  expect(await noSideways(page)).toBe(true);
  await section.scrollIntoViewIfNeeded();
  await shot(page, 'whats-new-about');
});
