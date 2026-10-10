// tests/e2e/key-issue-errors.spec.ts — mw-rch8bu: the Key screen's Issue, at 390 px in a real browser (jsdom does no
// layout). A refusal of 200 unbroken characters wraps instead of running off the right edge, and WhatsOnChain's 429
// page is never printed: the screen says it is busy and tries again.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { addressForPublicKey } from '../../src/services/licence';
import { signedRecordTxHex } from '../support/nftgate-fixtures';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const HOLDER = PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toString();

async function openIssue(page: Page, utxosAnswer: { status: number; error: string }) {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { collections: [{ name: 'trade-tracker' }], utxoSatoshis: 25_000 });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.goto('/?v=key');
  const issue = page.getByRole('region', { name: 'Issue a licence' });
  await expect(page.getByTestId('issue-cost')).toContainText('Balance: 25,000 sats');
  // Registered after the stub's own, so it answers first: the coin list now refuses.
  await page.route('**/api/utxos/**', (route) => route.fulfill({ status: utxosAnswer.status, json: { error: utxosAnswer.error } }));
  await issue.getByLabel("Holder's public key").fill(HOLDER);
  await issue.getByRole('button', { name: 'Issue' }).click();
  await issue.getByRole('button', { name: 'Confirm issue' }).click();
  return issue;
}

test('a 200-character unbroken error wraps and the Key screen does not scroll sideways', async ({ page }) => {
  const issue = await openIssue(page, { status: 502, error: 'x'.repeat(200) });
  const alert = issue.getByRole('alert');
  await expect(alert).toContainText('x'.repeat(200));
  await alert.scrollIntoViewIfNeeded();
  const widths = await alert.evaluate((el) => ({
    doc: document.documentElement.scrollWidth,
    view: window.innerWidth,
    scroll: el.scrollWidth,
    client: el.clientWidth,
    right: el.getBoundingClientRect().right,
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  expect(widths.scroll).toBe(widths.client);
  expect(widths.right).toBeLessThanOrEqual(widths.view);
  await shot(page, 'key-issue-long-error');
});

test("WhatsOnChain's 429 page is not printed: the screen says it is busy and trying again", async ({ page }) => {
  const page429 = '<html> <head> <title>429 Too Many Requests</title> </head> <body>nginx/1.18.0 (Ubuntu)</body> </html>';
  const issue = await openIssue(page, { status: 502, error: `WhatsOnChain said 429: ${page429}` });
  await expect(issue.getByRole('status')).toHaveText('WhatsOnChain is busy, trying again…');
  await expect(page.locator('body')).not.toContainText('nginx');
  await expect(page.locator('body')).not.toContainText('Too Many Requests');
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.view);
  await shot(page, 'key-issue-busy');
});

// mw-2f65hu: Revoke on an Issued row, the same two ways: WhatsOnChain's 429 page is never printed (the row says it is
// busy and tries again), and the longest plain line, "may have gone out", wraps inside the screen.
const WOC = 'https://api.whatsonchain.com/v1/bsv/test';

async function openRevoke(page: Page, broadcastAnswer: { status: number; error: string }) {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { collections: [{ name: 'trade-tracker' }], utxoSatoshis: 25_000 });
  const heldTxid = '1'.repeat(64);
  const txHex = { [heldTxid]: await signedRecordTxHex(governor, 'M', { collection: 'trade-tracker', holder: addressForPublicKey(HOLDER) }, 0) };
  const governorAddress = addressForPublicKey(governor.toPublicKey().toString());
  await page.route(`${WOC}/address/${governorAddress}/confirmed/history`, (route) => route.fulfill({ json: { result: [{ tx_hash: heldTxid, height: 100 }] } }));
  await page.route(`${WOC}/address/${governorAddress}/unconfirmed/history`, (route) => route.fulfill({ json: { result: [] } }));
  await page.route(`${WOC}/tx/*/hex`, (route) => {
    const txid = route.request().url().split('/').slice(-2)[0];
    return route.fulfill({ status: txHex[txid as keyof typeof txHex] ? 200 : 404, contentType: 'text/plain', body: txHex[txid as keyof typeof txHex] ?? 'not found' });
  });
  await page.route('**/api/broadcast', (route) => route.fulfill({ status: broadcastAnswer.status, json: { error: broadcastAnswer.error } }));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.goto('/?v=key');
  const row = page.getByTestId('issued-row');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Revoke' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  return row;
}

test("Revoke: WhatsOnChain's 429 page is not printed, the row says it is busy and trying again", async ({ page }) => {
  const page429 = '<html> <head> <title>429 Too Many Requests</title> </head> <body>nginx/1.18.0 (Ubuntu)</body> </html>';
  const row = await openRevoke(page, { status: 502, error: `WhatsOnChain said 429: ${page429}` });
  await expect(row.getByRole('status')).toHaveText('WhatsOnChain is busy, trying again…');
  await expect(page.locator('body')).not.toContainText('nginx');
  await expect(page.locator('body')).not.toContainText('said 429');
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.view);
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'key-revoke-busy');
});

test('Revoke: a broadcast that may have gone out says so in a line that wraps inside the screen', async ({ page }) => {
  const row = await openRevoke(page, { status: 502, error: 'WhatsOnChain said 503: <html>Service Unavailable</html>' });
  const alert = row.getByRole('alert');
  await expect(alert).toContainText('so it may have gone out');
  await expect(page.locator('body')).not.toContainText('<html');
  await alert.scrollIntoViewIfNeeded();
  const widths = await alert.evaluate((el) => ({
    doc: document.documentElement.scrollWidth,
    view: window.innerWidth,
    scroll: el.scrollWidth,
    client: el.clientWidth,
    right: el.getBoundingClientRect().right,
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  expect(widths.scroll).toBe(widths.client);
  expect(widths.right).toBeLessThanOrEqual(widths.view);
  await shot(page, 'key-revoke-may-have-gone-out');
});
