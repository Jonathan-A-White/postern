// tests/e2e/todo-rows.spec.ts — mw-ht6gsw.5: the To do board's rows in a real browser. The pass's picks are Do now (three) and Make time (two)
// across two lists, each card naming its list; Later and Let go are folded to their counts and open on a tap; Let go's cards carry Keep and Drop,
// and every control lies inside the screen at the width being shot.
// Shots: todo-rows-morning.png (the board as he finds it), todo-rows-later.png (Later open), todo-rows-let-go.png (Let go open); written, nothing committed.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot } from './shot';
import { fixtureView } from '../support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

test.use({ serviceWorkers: 'block' });

const day = 86_400_000;
const at = new Date(Date.now() - 20 * 60_000).toISOString();
const template = fixtureView().beads[0];
const bead = (id: string, extra: Partial<ViewBead>): ViewBead => ({ ...template, id, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: at, updated: at, ...extra });
const card = (id: string, parent: string, title: string, extra: Partial<ViewBead>): ViewBead => bead(id, { parent, title, labels: ['hitl', 'hitl:todo'], created: new Date(Date.now() - 3 * day).toISOString(), ...extra });

const BEADS: ViewBead[] = [
  bead('mw-6ww.114', { type: 'epic', title: 'Home', labels: ['hitl'], created: new Date(Date.now() - day).toISOString() }),
  bead('mw-5zz.2', { type: 'epic', title: 'Church', labels: ['hitl'], created: new Date(Date.now() - 2 * day).toISOString() }),
  card('mw-6ww.114.1', 'mw-6ww.114', 'Pay the water bill', { todo_row: 'now', todo_row_why: 'Due Friday', todo_due: new Date(Date.now() + day).toISOString(), todo_important: true, todo_size: 'quick' }),
  card('mw-6ww.114.2', 'mw-6ww.114', 'Renew the car tags', { todo_row: 'now', todo_row_why: 'Overdue and starred', todo_due: new Date(Date.now() - day).toISOString(), todo_important: true }),
  card('mw-5zz.2.1', 'mw-5zz.2', 'Call the dentist about the crown', { todo_row: 'now', todo_row_why: 'Due Saturday', todo_due: new Date(Date.now() + 2 * day).toISOString(), todo_size: 'hour' }),
  card('mw-5zz.2.2', 'mw-5zz.2', 'Write the Sunday lesson', { todo_row: 'make-time', todo_row_why: 'Starred, waiting 3 weeks', todo_important: true, todo_size: 'half-day' }),
  card('mw-6ww.114.3', 'mw-6ww.114', 'Sort the garage shelves', { todo_row: 'make-time', todo_row_why: 'Waiting 5 weeks' }),
  card('mw-6ww.114.4', 'mw-6ww.114', 'Try the new bakery', { todo_row: 'later' }),
  card('mw-5zz.2.3', 'mw-5zz.2', 'Read the long article', { todo_row: 'later' }),
  card('mw-5zz.2.4', 'mw-5zz.2', 'Look at the paint colours' , {}),
  card('mw-6ww.114.5', 'mw-6ww.114', 'Learn to juggle', { todo_row: 'let-go', todo_row_why: 'Untouched 41 days' }),
  card('mw-5zz.2.5', 'mw-5zz.2', 'Alphabetise the old hymnals', { todo_row: 'let-go', todo_row_why: 'Untouched 38 days' }),
];

async function open(page: Page): Promise<void> {
  const mnemonic = createMnemonic();
  const governor = PrivateKey.fromHex(Buffer.from(await deriveMasterKey(mnemonic)).toString('hex'));
  await stubBackend(page, governor, undefined, { beads: BEADS });
  await seedVault(page, mnemonic);
  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: /To do/ }).click();
  await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible();
}

/** Every card in `within` lies inside the width being shot. */
async function insideWidth(page: Page, within = page.locator('body')): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  for (const el of await within.getByTestId('todo-card').all()) {
    const box = await el.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
}

test('mw-ht6gsw.5: the board opens on Do now and Make time, with Later and Let go folded to their counts', async ({ page }) => {
  await open(page);
  const doNow = page.getByRole('region', { name: 'Do now', exact: true });
  const makeTime = page.getByRole('region', { name: 'Make time', exact: true });
  await expect(doNow.getByTestId('todo-card')).toHaveCount(3);
  await expect(makeTime.getByTestId('todo-card')).toHaveCount(2);
  // the due-soonest first (the overdue one), each card naming its list
  await expect(doNow.getByTestId('todo-card').first()).toContainText('Renew the car tags');
  await expect(doNow.getByTestId('todo-card').first().getByTestId('card-list')).toHaveText('Home');
  await expect(doNow.locator('[data-card="mw-5zz.2.1"]').getByTestId('card-list')).toHaveText('Church');
  await expect(doNow.locator('[data-card="mw-6ww.114.1"]').getByTestId('size-mark')).toHaveText('Q');
  await expect(page.getByRole('button', { name: 'Open Later · 3' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Open Let go · 2' })).toHaveAttribute('aria-expanded', 'false');
  // nothing of Later or Let go is on screen yet
  await expect(page.getByTestId('todo-card')).toHaveCount(5);
  await insideWidth(page);
  await shot(page, 'todo-rows-morning');

  // a card's back shows the pass's why
  await doNow.getByRole('button', { name: /^Pay the water bill/ }).click();
  await expect(page.getByRole('group', { name: 'Back of Pay the water bill' }).getByTestId('row-why')).toHaveText('Due Friday');
});

test('mw-ht6gsw.5: Later opens to the column per list, and stays open after a reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Open Later · 3' }).click();
  const home = page.getByRole('region', { name: 'Home', exact: true });
  const church = page.getByRole('region', { name: 'Church', exact: true });
  await expect(home.getByTestId('todo-card')).toHaveCount(1);
  await expect(church.getByTestId('todo-card')).toHaveCount(2);
  await expect(home.getByTestId('todo-card')).toContainText('Try the new bakery');
  await home.scrollIntoViewIfNeeded();
  await insideWidth(page, home); // the next list's column is a swipe away, as on any phone
  await page.getByRole('region', { name: 'Later', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'todo-rows-later');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Fold Later · 3' })).toBeVisible();
});

test('mw-ht6gsw.5: Let go opens to its cards, each with Keep and Drop, and Keep sends it back to Later', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Open Let go · 2' }).click();
  const letGo = page.getByRole('region', { name: 'Let go', exact: true });
  await expect(letGo.getByTestId('todo-card')).toHaveCount(2);
  const learn = letGo.locator('[data-card="mw-6ww.114.5"]');
  await expect(learn.getByRole('button', { name: 'Keep: Learn to juggle' })).toBeVisible();
  await expect(learn.getByRole('button', { name: 'Drop: Learn to juggle' })).toBeVisible();
  await insideWidth(page);
  await letGo.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'todo-rows-let-go');

  // Drop waits for the Mayor, and says so
  await learn.getByRole('button', { name: 'Drop: Learn to juggle' }).click();
  await expect(learn.getByRole('status')).toHaveText('Dropped, waiting for the Mayor');
  await expect(learn.getByRole('button', { name: /^(Keep|Drop)/ })).toHaveCount(0);

  // Keep moves the other card out of Let go into Later at once
  await letGo.locator('[data-card="mw-5zz.2.5"]').getByRole('button', { name: 'Keep: Alphabetise the old hymnals' }).click();
  await expect(page.getByRole('button', { name: 'Open Later · 4' })).toBeVisible();
});
