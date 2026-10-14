// tests/e2e/todo-board.spec.ts — mw-ev7oyy.4: the To do tab in a real browser. A view with an epic and
// two hitl:todo children shows To do with the epic's title and both cards; Done on one queues a close
// action for that bead in the outbox and greys the row; a tap on a card turns it over to its back
// (its description) and Back returns; the six tabs fit the width, 360 px included.
// mw-ev7oyy.7: a card is added at a list's foot (the Mayor's host, simulated, applies it and echoes it), dragged above
// another and its title edited: the outbox holds the three §13 actions with their shapes and the board shows the new order.
// Shots: todo-board.png, todo-card-back.png, todo-board-hand-edits.png.
// mw-ev7oyy.9: a due time set on a card's back goes out as a todo_edit with due and shows on the card's face (todo-card-due.png, todo-board-due.png).
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { encryptMessage } from '../../src/services/messages';
import { sealDocument } from '../../src/services/documents';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';
import { MAYOR, fixtureView } from '../support/cockpit-fixture';
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

test('add a card, drag it above another, edit its title: the outbox holds the three actions and the board shows the new order', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS });

  // Every action he sends gets its own txid; the Mayor's host, simulated, applies the add (and no more) and echoes it.
  const txids: string[] = [];
  let applied = false;
  const NEW = 'mw-6ww.114.4';
  const FIRST = 'Take the trash out of the garage';
  await page.route('**/api/messages**', async (route) => {
    if (route.request().method() === 'POST') {
      txids.push(`direct:${String(txids.length + 1).padStart(64, '0')}`);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ txid: txids[txids.length - 1], seq: 900 + txids.length }) });
    }
    if (!applied || Number(new URL(route.request().url()).searchParams.get('since') ?? 0) >= 1000) return route.fallback();
    const echo = { seq: 20, ts: new Date().toISOString(), kind: 'action_applied', bead: NEW, actor: 'mw@laptop', from: '', to: '', detail: txids[0], lane: 'normal' };
    const record = {
      seq: 1000,
      txid: `direct:${'f'.repeat(64)}`,
      vout: 0,
      payload: { ...encryptMessage({ text: JSON.stringify({ from: 20, to: 20, lane: 'normal', events: [echo] }), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: governor.toPublicKey().toString() }), ts: Math.floor(Date.now() / 1000) },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [record], next: 1000 }) });
  });
  await page.route(/\/api\/view(\?|$)/, async (route) => {
    if (!applied) return route.fallback();
    const base = fixtureView(Date.now());
    const made = bead(NEW, { parent: 'mw-6ww.114', title: 'Buy bin bags', labels: ['hitl', 'hitl:todo'], created: new Date().toISOString() });
    const sealed = await sealDocument(JSON.stringify({ ...base, seq: 20, beads: [...base.beads, ...BEADS, made] }), MAYOR.toHex(), governor.toPublicKey().toString());
    return route.fulfill({ status: 200, contentType: 'text/plain', headers: { ETag: '"applied"' }, body: sealed });
  });

  await seedVault(page, mnemonic);
  await page.goto('/?v=todo');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  const column = page.getByRole('region', { name: 'Governor’s list, this morning' });
  await expect(column.getByRole('button', { name: FIRST })).toBeVisible();

  // 1. Add a card at the list's foot: it shows at once, last, marked pending.
  await column.getByRole('button', { name: 'Add a card' }).click();
  await column.getByLabel('Title of the new card').fill('Buy bin bags');
  await column.getByRole('button', { name: 'Add', exact: true }).click();
  const names = () => column.getByTestId('todo-card').evaluateAll((cards) => cards.map((card) => card.querySelector('span')?.textContent ?? ''));
  await expect.poll(names).toEqual([FIRST, 'Do the recycling on the back deck', 'Buy bin bags']);
  await expect(column.getByTestId('todo-card').last().getByTestId('pending-mark')).toBeVisible();
  await expect.poll(() => txids.length).toBe(1);

  // The host applies it: the card is real once the view has reached the echo.
  applied = true;
  await page.reload();
  await expect(column.getByRole('button', { name: 'Buy bin bags' })).toBeVisible({ timeout: 30_000 });
  await expect(column.getByTestId('todo-card').filter({ hasText: 'Buy bin bags' }).getByTestId('pending-mark')).toHaveCount(0);

  // 2. Drag it above the first card (a mouse picks a card up after a few pixels).
  const grab = column.getByRole('button', { name: 'Buy bin bags' });
  await grab.scrollIntoViewIfNeeded();
  const from = (await grab.boundingBox())!;
  const above = (await column.getByRole('button', { name: FIRST }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 - 10, { steps: 3 });
  await page.mouse.move(above.x + above.width / 2, above.y - 4, { steps: 8 });
  await expect(page.getByTestId('drop-mark')).toBeVisible();
  await page.mouse.up();
  await expect.poll(names).toEqual(['Buy bin bags', FIRST, 'Do the recycling on the back deck']);
  await expect(column.getByTestId('todo-card').first().getByTestId('pending-mark')).toBeVisible();

  // 3. Edit its title on its back.
  await column.getByRole('button', { name: 'Buy bin bags' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Buy bin bags and tape');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(column.getByText('Buy bin bags and tape').first()).toBeVisible();
  await shot(page, 'todo-board-hand-edits');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(names).toEqual(['Buy bin bags and tape', FIRST, 'Do the recycling on the back deck']);

  // The outbox holds the three actions, in order, with the §13 shapes.
  const actions = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('PosternDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction(['outbox'], 'readonly').objectStore('outbox').getAll();
          all.onsuccess = () => resolve(all.result.map((row: { payload: { action: unknown } }) => row.payload.action));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(actions).toEqual([
    { action: 'todo_add', list: 'mw-6ww.114', title: 'Buy bin bags' },
    { action: 'todo_move', bead: NEW, before: 'mw-6ww.114.1' },
    { action: 'todo_edit', bead: NEW, title: 'Buy bin bags and tape' },
  ]);
});

test('mw-ev7oyy.9: a due time set on a card’s back is in the outbox as a todo_edit and shows on the card’s face', async ({ page }) => {
  await open(page);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const picked = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T17:00`;

  await page.getByRole('button', { name: 'Take the trash out of the garage' }).click();
  const back = page.getByRole('group', { name: 'Back of Take the trash out of the garage' });
  await expect(back.getByRole('button', { name: 'Set due' })).toBeDisabled();
  await back.getByLabel('Due', { exact: true }).fill(picked);
  await shot(page, 'todo-card-due');
  await back.getByRole('button', { name: 'Set due' }).click();

  const actions = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('PosternDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction(['outbox'], 'readonly').objectStore('outbox').getAll();
          all.onsuccess = () => resolve(all.result.map((row: { payload: { action: unknown } }) => row.payload.action));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(actions).toEqual([{ action: 'todo_edit', bead: 'mw-6ww.114.1', due: tomorrow.toISOString() }]);

  await back.getByRole('button', { name: 'Back', exact: true }).click();
  const card = page.getByTestId('todo-card').filter({ hasText: 'Take the trash out of the garage' });
  await expect(card.getByTestId('due')).toHaveText('Tomorrow 17:00');
  await expect(card.getByTestId('due')).toHaveAttribute('data-past', 'false');
  await shot(page, 'todo-board-due');
});
