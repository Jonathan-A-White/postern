// tests/e2e/todo-calendar.spec.ts — mw-ev7oyy.32: a To do card with a When: line shows Add to Google Calendar and Download .ics.
// In a real browser the Download .ics tap saves a file whose content is a calendar with DTSTART/DTEND in floating local time, the
// title as SUMMARY and the bead id in DESCRIPTION; the other tap links to Google's new-event page. Both sit inside the card.
// Shot: todo-calendar.png (the card with its two taps; written, nothing committed).
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

test.use({ serviceWorkers: 'block' });

const at = new Date(Date.now() - 20 * 60_000).toISOString();
const template = fixtureView().beads[0];
const bead = (id: string, extra: Partial<ViewBead>): ViewBead => ({ ...template, id, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: at, updated: at, ...extra });

const BEADS: ViewBead[] = [
  bead('mw-6ww.114', { type: 'epic', title: 'Governor’s list, this morning', labels: ['hitl'] }),
  bead('mw-6ww.114.17', { parent: 'mw-6ww.114', title: 'Blood work, Friday', labels: ['hitl', 'hitl:todo'], summary: 'Get it done.\n\nWhen: 2026-10-23 07:30 (his local time)' }),
  bead('mw-6ww.114.2', { parent: 'mw-6ww.114', title: 'Do the recycling on the back deck', labels: ['hitl', 'hitl:todo'], summary: 'No time for this one.' }),
];

async function open(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ['postern.todo.folds', JSON.stringify({ later: true })]);
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS, descriptions: { 'mw-6ww.114.17': 'Get it done.\n\nWhen: 2026-10-23 07:30 (his local time)' } });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /To do/ }).click();
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
}

test('mw-ev7oyy.32: Download .ics saves a calendar file for the When: line; Add to Google Calendar links to the new event; a card without a When: line has neither', async ({ page }) => {
  await open(page);
  const card = page.locator('[data-card="mw-6ww.114.17"]');
  const google = card.getByRole('link', { name: 'Add to Google Calendar' });
  const ics = card.getByRole('link', { name: 'Download .ics' });
  await expect(google).toBeVisible();
  await expect(page.locator('[data-card="mw-6ww.114.2"]').getByRole('link', { name: /Google Calendar|\.ics/ })).toHaveCount(0);

  const url = new URL((await google.getAttribute('href')) ?? '');
  expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
  expect(url.searchParams.get('text')).toBe('Blood work, Friday');
  expect(url.searchParams.get('dates')).toBe('20261023T073000/20261023T080000');
  expect(url.searchParams.get('details')).toContain('mw-6ww.114.17');

  const downloading = page.waitForEvent('download');
  await ics.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('mw-6ww.114.17.ics');
  const file = readFileSync((await download.path()) ?? '', 'utf8');
  const lines = file.split('\r\n');
  expect(lines[0]).toBe('BEGIN:VCALENDAR');
  expect(lines).toContain('DTSTART:20261023T073000');
  expect(lines).toContain('DTEND:20261023T080000');
  expect(lines).toContain('SUMMARY:Blood work\\, Friday');
  expect(lines.find((line) => line.startsWith('DESCRIPTION:'))).toContain('mw-6ww.114.17');
  expect(file).not.toMatch(/DT(START|END)[^\r\n]*Z/);

  // both taps lie inside the card, at the width being shot
  const width = page.viewportSize()?.width ?? 0;
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  for (const tap of [google, ics]) {
    const own = await tap.boundingBox();
    expect(own!.x + own!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
  await shot(page, 'todo-calendar');

  // the back of the card shows the same two taps
  await page.getByRole('button', { name: /^Blood work, Friday/ }).click();
  const back = page.getByRole('group', { name: 'Back of Blood work, Friday' });
  await expect(back.getByRole('link', { name: 'Add to Google Calendar' })).toBeVisible();
  await expect(back.getByRole('link', { name: 'Download .ics' })).toBeVisible();
});
