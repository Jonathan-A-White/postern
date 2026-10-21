// tests/e2e/launch-big-history.spec.ts — mw-4gkijo.1: a phone with a large history (5000 messages, a fifth of
// them twins an older build kept twice) opens on the app's own screen at once and reaches the door without
// waiting on the history-wide cleanups. The times are logged for the closing comment.
// The 1 s and 3 s are real time (a timing test: docs/timing-tests.md), scaled by how slow the host is when they are
// read (host-slowdown.ts), so a loaded host cannot fail them. covers: src/App.tsx, src/main.tsx, src/data/**, src/cockpit/Gate*
import { test, expect, type Page } from '@playwright/test';
import { createMnemonic } from '../../src/services/vault';
import { seedVault } from './cockpit-stub';
import { shot, sized } from './shot';
import { hostSlowdown } from './host-slowdown';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

const MESSAGES = Number(process.env.SEED_MESSAGES ?? 5000);

// Seeds `MESSAGES` rows straight into IndexedDB: every fifth is the chain copy of the row before it.
async function seedHistory(page: Page): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['messages'], 'readwrite');
          const store = tx.objectStore('messages');
          const body = 'x'.repeat(600);
          for (let i = 0; i < count; i++) {
            const twin = i % 5 === 4;
            const n = twin ? i - 1 : i;
            const txid = twin ? `${'0'.repeat(60)}${String(n).padStart(4, '0')}` : `direct:${String(n).padStart(64, '0')}`;
            store.put({
              id: `${txid}:0`,
              txid,
              vout: 0,
              seq: i,
              class: i % 50 === 0 ? 'events' : 'message',
              to: 'phone',
              from: 'mayor',
              ts: 1_790_000_000 + n,
              ciphertext: `${body}${n}`,
              direction: 'received',
              read: true,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    MESSAGES,
  );
}

async function storedCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction(['messages']).objectStore('messages').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );
}

test(`${MESSAGES} stored messages: the app paints within 1 s of load and the door is there within 3 s`, async ({ page }) => {
  const mnemonic = createMnemonic();
  await seedVault(page, mnemonic);
  await seedHistory(page);

  // Marks, in ms from the start of the navigation, when #root first holds the app's own screen and when the door's Unlock appears.
  await page.addInitScript(() => {
    const marks: Record<string, number> = {};
    (window as unknown as { __marks: Record<string, number> }).__marks = marks;
    new MutationObserver(() => {
      const root = document.getElementById('root');
      if (root?.querySelector('main') && marks.paint === undefined) marks.paint = performance.now();
      if (root && /Recovery phrase/.test(root.textContent ?? '') && marks.door === undefined) marks.door = performance.now();
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto('/');
  await expect(page.getByLabel('Recovery phrase')).toBeVisible({ timeout: 20_000 });
  const marks = await page.evaluate(() => (window as unknown as { __marks: Record<string, number> }).__marks);
  console.log(`launch with ${MESSAGES} messages: first paint ${Math.round(marks.paint)} ms, door ${Math.round(marks.door)} ms`);
  const slowdown = await hostSlowdown(page);
  expect(marks.paint, 'the app paints its own screen').toBeLessThan(1000 * slowdown);
  expect(marks.door, 'the door is reached').toBeLessThan(3000 * slowdown);
  // The clean-ups ran after the door was shown: the events rows and the twins are gone, the real messages stay.
  // 1 in 50 is an events row and 1 in 5 a chain twin (seedHistory).
  await expect.poll(() => storedCount(page), { timeout: 30_000 }).toBe(MESSAGES - MESSAGES / 50 - MESSAGES / 5);
  await shot(page, 'launch-big-history');
});
