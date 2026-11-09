// tests/e2e/attachment-save.spec.ts — mw-azvrhbq: an attached PDF in a thread has a Save beside it that downloads it
// under its attachment name (the download event and its suggestedFilename); a tap on the file still opens a new tab.
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';

test.use({ serviceWorkers: 'block' });

const SLOW_STAGE = 30_000;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

test('an attached PDF has a Save that downloads it under its name, and a tap still opens a tab', async ({ page, context }) => {
  test.slow();
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, { bytes: PDF, mime: 'application/pdf', name: 'roadmap.pdf' });
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: SLOW_STAGE });

  await page.goto('/?v=bead&id=mw-f758y.30.2');
  const file = page.getByRole('button', { name: /^roadmap\.pdf/ });
  await expect(file).toBeVisible({ timeout: SLOW_STAGE });

  // Save downloads the PDF, its own bytes, under its attachment name
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save roadmap.pdf' }).click();
  const saved = await downloading;
  expect(saved.suggestedFilename()).toBe('roadmap.pdf');
  expect(Buffer.compare(await readFile(await saved.path()), PDF)).toBe(0);

  // a tap on the file itself still opens it in a new tab
  const opened = context.waitForEvent('page');
  await file.click();
  const tab = await opened;
  expect(tab.url()).toMatch(/^blob:/);
});
