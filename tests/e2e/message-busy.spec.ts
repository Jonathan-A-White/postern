// tests/e2e/message-busy.spec.ts — mw-qkb7yp: a message sent as a transaction (a backend without direct delivery) at
// 390 px in a real browser (jsdom does no layout). A broadcast refused with 200 unbroken characters wraps inside the
// screen, and WhatsOnChain's 429 page is never printed: the message says it is busy and is tried again.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { MAYOR } from '../support/cockpit-fixture';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

async function sendWhenBroadcastAnswers(page: Page, answer: { status: number; error: string }): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { utxoSatoshis: 25_000 });
  // Registered after the stub's own, so it answers first: a backend without direct delivery.
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { pubkey: governor.toPublicKey().toString(), mayor: MAYOR.toPublicKey().toString(), network: 'testnet', features: ['events', 'view', 'beads', 'me'] } }),
  );
  await page.route('**/api/broadcast', (route) => route.fulfill({ status: answer.status, json: { error: answer.error } }));
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.goto('/?v=talk&t=general');
  await page.getByRole('textbox', { name: 'Message' }).fill('Ship it');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function expectInsideScreen(page: Page, selector: string): Promise<void> {
  const target = page.getByTestId(selector).first();
  await target.scrollIntoViewIfNeeded();
  const widths = await target.evaluate((el) => ({
    doc: document.documentElement.scrollWidth,
    view: window.innerWidth,
    scroll: el.scrollWidth,
    client: el.clientWidth,
    right: el.getBoundingClientRect().right,
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  expect(widths.scroll).toBe(widths.client);
  expect(widths.right).toBeLessThanOrEqual(widths.view);
}

test('a failed send with a 200-character unbroken error wraps inside the screen', async ({ page }) => {
  await sendWhenBroadcastAnswers(page, { status: 400, error: 'x'.repeat(200) });
  const note = page.getByTestId('failed-note');
  await expect(note).toContainText('x'.repeat(200));
  await expectInsideScreen(page, 'failed-note');
  await shot(page, 'message-failed-long-error');
});

test("WhatsOnChain's 429 page is not printed under the message: it says it is busy and trying again", async ({ page }) => {
  const page429 = '<html> <head> <title>429 Too Many Requests</title> </head> <body>nginx/1.18.0 (Ubuntu)</body> </html>';
  await sendWhenBroadcastAnswers(page, { status: 502, error: `WhatsOnChain said 429: ${page429}` });
  await expect(page.getByTestId('outbox-note')).toHaveText('WhatsOnChain is busy, trying again…');
  await expect(page.locator('body')).not.toContainText('nginx');
  await expect(page.locator('body')).not.toContainText('Too Many Requests');
  await expect(page.locator('body')).not.toContainText('said 429');
  await expectInsideScreen(page, 'outbox-note');
  await shot(page, 'message-busy');
});
