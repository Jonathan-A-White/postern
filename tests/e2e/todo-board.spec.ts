// tests/e2e/todo-board.spec.ts — mw-ev7oyy.4: the To do tab in a real browser. A view with an epic and
// two hitl:todo children shows To do with the epic's title and both cards; Done on one queues a close
// action for that bead in the outbox and greys the row; a tap on a card turns it over to its back
// (its description) and Back returns; the six tabs fit the width, 360 px included.
// Shots: todo-board.png, todo-card-back.png.
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
  bead('mw-6ww.114.1', { parent: 'mw-6ww.114', title: 'Take the trash out of the garage', labels: ['hitl', 'hitl:todo'], created: new Date(Date.now() - 3_600_000).toISOString() }),
  bead('mw-6ww.114.2', { parent: 'mw-6ww.114', title: 'Do the recycling on the back deck', labels: ['hitl', 'hitl:todo'] }),
  bead('mw-6ww.114.3', { parent: 'mw-6ww.114', title: 'Already carried out', labels: ['hitl', 'hitl:todo'], status: 'closed', closed: at }),
  bead('mw-5zz.2', { type: 'epic', title: 'Later this week', labels: ['hitl'], created: new Date(Date.now() - 86_400_000).toISOString() }),
  bead('mw-5zz.2.1', { parent: 'mw-5zz.2', title: 'Check the TrueCrypt volume opens', labels: ['hitl', 'hitl:todo'] }),
];

async function open(page: Page): Promise<{ posted: string[]; release: () => void }> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  const { posted } = await stubBackend(page, governor, undefined, {
    beads: BEADS,
    descriptions: { 'mw-6ww.114.1': 'The bin is by the garage door. Then see mw-6ww.114.2 for the recycling.' },
  });
  // A message sent waits here, so the close action is seen in the outbox before it goes.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/messages**', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /To do/ }).click();
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
  return { posted, release };
}

test('To do lists each epic as a column of its open cards; Done queues a close and greys the card', async ({ page }) => {
  const { release } = await open(page);

  const column = page.getByRole('region', { name: 'Governor’s list, this morning' });
  await expect(column.getByRole('button', { name: 'Take the trash out of the garage' })).toBeVisible();
  await expect(column.getByRole('button', { name: 'Do the recycling on the back deck' })).toBeVisible();
  await expect(column.getByText('Already carried out')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Later this week' })).toBeAttached();
  await expect(page.getByRole('link', { name: 'Governor’s list, this morning' })).toHaveAttribute('href', '?v=bead&id=mw-6ww.114');
  // Three open cards: the tab says so.
  await expect(page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /To do/ })).toContainText('3');
  await shot(page, 'todo-board');

  const card = column.getByTestId('todo-card').filter({ hasText: 'Take the trash out of the garage' });
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByText('Done, waiting for the Mayor')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await expect(card).toHaveCSS('opacity', '0.6');
  // The other card is untouched.
  await expect(column.getByTestId('todo-card').filter({ hasText: 'Do the recycling' }).getByRole('button', { name: 'Done' })).toBeEnabled();

  // The tap is in the outbox as a close for that bead (the send is held back until released).
  const rows = await page.evaluate(
    () =>
      new Promise<{ kind: string; bead: string; action?: string }[]>((resolve, reject) => {
        const request = indexedDB.open('PosternDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction(['outbox'], 'readonly').objectStore('outbox').getAll();
          all.onsuccess = () => resolve(all.result.map((row: { kind: string; bead: string; payload: { action?: { action?: string } } }) => ({ kind: row.kind, bead: row.bead, action: row.payload.action?.action })));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(rows).toEqual([{ kind: 'action', bead: 'mw-6ww.114.1', action: 'close' }]);
  release();
});

test('a tap on a card shows its back with its description, and Back returns', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Take the trash out of the garage' }).click();
  const back = page.getByRole('group', { name: 'Back of Take the trash out of the garage' });
  await expect(back.getByText('The bin is by the garage door.')).toBeVisible();
  await expect(back.getByRole('link', { name: 'mw-6ww.114.2' }).first()).toHaveAttribute('href', '?v=bead&id=mw-6ww.114.2');
  await shot(page, 'todo-card-back');
  await back.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('group', { name: /^Back of/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take the trash out of the garage' })).toBeVisible();
});

test('the six tabs fit the width, none cut off or hidden', async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  // From 1024 px the places are a sidebar, not a tab bar.
  test.skip(width >= 1024, 'a wide screen has the sidebar');
  await open(page);
  const tabs = page.getByRole('navigation', { name: 'Places' }).getByRole('link');
  await expect(tabs).toHaveCount(6);
  const boxes = await tabs.evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      const label = Array.from(link.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) as Text;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      return { label: label.textContent, left: rect.left, right: rect.right, textLeft: text.left, textRight: text.right, textHeight: text.height, scroll: link.scrollWidth, client: link.clientWidth };
    }),
  );
  expect(boxes.map((box) => box.label)).toEqual(['Needs you', 'To do', 'Map', 'Channels', 'Search', 'Me']);
  for (const box of boxes) {
    expect(box.left, box.label ?? '').toBeGreaterThanOrEqual(0);
    expect(box.right, box.label ?? '').toBeLessThanOrEqual(width);
    // the label is on one line and sits inside its own tab
    expect(box.textHeight, box.label ?? '').toBeLessThan(20);
    expect(box.textLeft, box.label ?? '').toBeGreaterThanOrEqual(box.left - 0.5);
    expect(box.textRight, box.label ?? '').toBeLessThanOrEqual(box.right + 0.5);
    expect(box.scroll, box.label ?? '').toBeLessThanOrEqual(box.client);
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
});
