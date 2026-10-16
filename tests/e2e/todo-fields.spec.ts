// tests/e2e/todo-fields.spec.ts — mw-ht6gsw.4: a To do card's size and Then line in a real browser. A card the view
// gives the size hour and a Then line shows 1h on its front; its back marks an Hour, carries the Then line, and every
// control sits inside the card at the width being shot. A tap on Quick turns the front's mark to Q at once.
// Shot: todo-card-fields.png (the card's back with its size and Then line; written, nothing committed).
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
  bead('mw-6ww.114.1', { parent: 'mw-6ww.114', title: 'Take the trash out of the garage', labels: ['hitl', 'hitl:todo'], todo_size: 'hour', todo_then: 'Book the plumber about the drain' }),
  bead('mw-6ww.114.2', { parent: 'mw-6ww.114', title: 'Do the recycling on the back deck', labels: ['hitl', 'hitl:todo'] }),
];

async function open(page: Page): Promise<void> {
  const open = { today: true, soon: true, someday: true };
  const kept = Object.fromEntries(['mw-6ww.114', 'other'].map((id) => [id, open]));
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ['postern.todo.groups', JSON.stringify(kept)]);
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /To do/ }).click();
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
}

test('mw-ht6gsw.4: a card’s back shows its size and Then line inside the card, and a tap on Quick shows Q at once', async ({ page }) => {
  await open(page);
  const front = page.locator('[data-card="mw-6ww.114.1"]');
  await expect(front.getByTestId('size-mark')).toHaveText('1h');
  await expect(page.locator('[data-card="mw-6ww.114.2"]').getByTestId('size-mark')).toHaveCount(0);

  await page.getByRole('button', { name: /^Take the trash out of the garage/ }).click();
  const back = page.getByRole('group', { name: 'Back of Take the trash out of the garage' });
  await expect(back.getByRole('button', { name: 'an Hour' })).toHaveAttribute('aria-pressed', 'true');
  await expect(back.getByRole('textbox', { name: 'Then' })).toHaveValue('Book the plumber about the drain');
  await back.getByRole('textbox', { name: 'Then' }).scrollIntoViewIfNeeded();
  await shot(page, 'todo-card-fields');

  // every control of the back lies inside the card, at the width being shot
  const width = page.viewportSize()?.width ?? 0;
  const card = await page.locator('[data-card="mw-6ww.114.1"]').boundingBox();
  expect(card).not.toBeNull();
  expect(card!.x + card!.width).toBeLessThanOrEqual(width + 1);
  for (const control of await back.getByRole('button').all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.x + box.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  }

  await back.getByRole('button', { name: 'Quick' }).click();
  await expect(back.getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'true');
  await back.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(front.getByTestId('size-mark')).toHaveText('Q');
});
