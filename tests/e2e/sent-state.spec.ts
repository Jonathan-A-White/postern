// tests/e2e/sent-state.spec.ts — mw-gq6.965: a message sent on chain from the phone says what is
// known of it. 'Sent on chain' read as delivered, and proved only that WhatsOnChain took the
// transaction: the Mayor's side had not seen it. It reads 'On chain, not yet received' until the
// backend's own copy of the record has come back, then 'Received on chain'. At 390x844.
import { test, expect, type Page } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { encodeThreadedMessage } from '../../src/services/threads';
import { MAYOR } from '../support/cockpit-fixture';
import { seedVault, stubBackend } from './cockpit-stub';
import { shot, sized } from './shot';

test.use({ serviceWorkers: 'block', viewport: sized({ width: 390, height: 844 }) });

const BEAD = 'mw-2rbm.6';
const NO_BACKEND_SEQ = Number.MAX_SAFE_INTEGER;

interface SentRow {
  txid: string;
  seq: number;
  text: string;
  ts: number;
}

/** Writes sent rows into the phone's own database, as `deliver` keeps them when it sends. */
async function keepSent(page: Page, from: string, rows: SentRow[]): Promise<void> {
  const to = MAYOR.toPublicKey().toString();
  await page.evaluate(
    ({ rows: list, from: me, to: mayor, thread }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['messages'], 'readwrite');
          for (const row of list) {
            tx.objectStore('messages').put({
              id: `${row.txid}:0`,
              txid: row.txid,
              vout: 0,
              seq: row.seq,
              class: 'message',
              to: mayor,
              from: me,
              ts: row.ts,
              ciphertext: '',
              plaintext: row.text,
              direction: 'sent',
              read: true,
              thread,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { rows, from, to, thread: `bead:${BEAD}` },
  );
}

test('a message sent on chain says it is not yet received until the backend has it, and a direct one says only the time', async ({ page }) => {
  const mnemonic = createMnemonic();
  const master = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(master).toString('hex'));
  await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  await page.goto('/');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  const now = Math.floor(Date.now() / 1000);
  const text = (words: string) => encodeThreadedMessage({ thread: { bead: BEAD }, text: words });
  await keepSent(page, publicKeyHexFromMasterKey(master), [
    { txid: 'a'.repeat(64), seq: NO_BACKEND_SEQ, text: text('Sent while offline, not seen by the backend'), ts: now - 300 },
    { txid: 'b'.repeat(64), seq: 405_810, text: text('Sent while offline, the backend has it'), ts: now - 200 },
    { txid: `direct:${'c'.repeat(64)}`, seq: 405_811, text: text('Sent with a signal'), ts: now - 100 },
  ]);

  await page.goto(`/?v=talk&t=bead%3A${BEAD}`);
  const unseen = page.getByTestId('message').filter({ hasText: 'Sent while offline, not seen by the backend' });
  await expect(unseen).toContainText(/On chain, not yet received \d{1,2}:\d{2}( [AP]M)?/);
  await expect(unseen).not.toContainText('Sent on chain');

  const seen = page.getByTestId('message').filter({ hasText: 'Sent while offline, the backend has it' });
  await expect(seen).toContainText(/Received on chain \d{1,2}:\d{2}( [AP]M)?/);

  const direct = page.getByTestId('message').filter({ hasText: 'Sent with a signal' });
  await expect(direct).not.toContainText('chain');
  await expect(direct).toContainText(/\d{1,2}:\d{2}( [AP]M)?/);

  await unseen.scrollIntoViewIfNeeded();
  await shot(page, 'sent-state');
});
