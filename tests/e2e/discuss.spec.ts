// tests/e2e/discuss.spec.ts — mw-f758y.21.5: a Discuss control on the Projects
// screen's epic row and the Project screen's story row, each opening that
// bead's thread, at a 390px phone width. A fake vault and snapshot are seeded
// the same way tests/e2e/project-view.spec.ts does.
import { test, expect } from '@playwright/test';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import {
  createMnemonic,
  deriveMasterKey,
  deriveAesKeyFromPhrase,
  wrapKey,
  publicKeyHexFromMasterKey,
} from '../../src/services/vault';
import type { Snapshot } from '../../src/services/questions';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const MAYOR_KEY = PrivateKey.fromHex('99'.repeat(32));
const EPIC_ID = 'mw-discuss';
const EPIC_TITLE = 'The discuss epic';
const BEAD_ID = 'mw-discuss.1';
const QUESTION_TEXT = 'Ship the Discuss control now?';

function encryptSnapshot(snapshot: Snapshot, recipientPublicKeyHex: string): string {
  const plaintextBytes = Utils.toArray(JSON.stringify(snapshot), 'utf8');
  const encrypted = EncryptedMessage.encrypt(plaintextBytes, MAYOR_KEY, PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}

function needsYouSnapshot(): Snapshot {
  const now = new Date().toISOString();
  return {
    written_at: now,
    epics: [
      {
        id: EPIC_ID,
        title: EPIC_TITLE,
        priority: 'P1',
        status: 'in-progress',
        needs_you: [{ id: BEAD_ID, title: QUESTION_TEXT, asked_at: now, recommended: 'ship', options: ['ship'] }],
        landed: [],
        working: [],
        closed_count: 0,
      },
    ],
  };
}

test('Discuss controls on the epic row and the story row open that bead\'s thread', async ({ page }) => {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  const mayorPublicKeyHex = MAYOR_KEY.toPublicKey().toString();
  const snapshotBase64 = encryptSnapshot(needsYouSnapshot(), publicKeyHex);

  await page.route('**/snapshot', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: snapshotBase64 }));
  await page.route('**/api/messages**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [], next: 0 }) }),
  );

  // A first visit opens PosternDB with its real schema (Dexie auto-creates it on
  // the first table read) so the seed below writes into a database shaped exactly
  // as the app itself would leave it.
  await page.goto('/?screen=projects');
  await expect(page.getByText('No key is set up on this phone yet.')).toBeVisible();

  await page.evaluate(
    ({ ciphertext, iv, salt, publicKeyHex, mayorPublicKeyHex }) => {
      return new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open('PosternDB');
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          const tx = db.transaction(['vault', 'settings'], 'readwrite');
          tx.objectStore('vault').put({
            id: 'default',
            mode: 'phrase',
            ciphertext: new Uint8Array(ciphertext).buffer,
            iv: new Uint8Array(iv),
            salt: new Uint8Array(salt),
            prfFallbackReason: 'webauthn-unavailable',
            publicKeyHex,
          });
          tx.objectStore('settings').put({ key: 'mayor-public-key', value: mayorPublicKeyHex });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      ciphertext: Array.from(new Uint8Array(wrapped.ciphertext)),
      iv: Array.from(wrapped.iv),
      salt: Array.from(salt),
      publicKeyHex,
      mayorPublicKeyHex,
    },
  );

  async function unlock(): Promise<void> {
    await page.getByLabel('Recovery phrase').fill(mnemonic);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }

  // Projects screen: the epic row's Discuss control opens that epic's own thread.
  await page.goto('/?screen=projects');
  await unlock();
  const epicRow = page.getByTestId('epic-row');
  await expect(epicRow).toContainText(EPIC_TITLE);
  await epicRow.getByRole('link', { name: 'Discuss' }).click();
  await unlock();
  await expect(page.getByRole('heading', { name: EPIC_TITLE })).toBeVisible();
  await expect(page.getByText('No messages yet.')).toBeVisible();

  // Project screen: the story row's Discuss control opens that bead's own thread.
  await page.goto(`/?screen=project&epic=${EPIC_ID}`);
  await unlock();
  const needsYouRow = page.getByTestId('needs-you-row');
  await expect(needsYouRow).toContainText(QUESTION_TEXT);
  await needsYouRow.getByRole('link', { name: 'Discuss' }).click();
  await unlock();
  await expect(page.getByRole('heading', { name: QUESTION_TEXT })).toBeVisible();
  await expect(page.getByText('No messages yet.')).toBeVisible();

  await shot(page, 'discuss');
});
