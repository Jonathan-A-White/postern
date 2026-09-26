// tests/e2e/project-view.spec.ts — mw-tfne4.7: the whole app path against fakes,
// in a real browser rather than jsdom (features/steps/question.steps.tsx already
// proves the same flow under vitest). A fake vault is written straight into
// IndexedDB (no WebAuthn ceremony in headless Chromium); GET /snapshot, GET
// /api/utxos/{address} and POST /api/broadcast are stubbed with page.route. The
// service worker is blocked so it can never shadow those stubs with a cached
// response.
import { test, expect } from '@playwright/test';
import { PrivateKey, PublicKey, Transaction, Utils } from '@bsv/sdk';
import { EncryptedMessage, decodeRecordScript } from 'spell-forge-bsv';
import {
  createMnemonic,
  deriveMasterKey,
  deriveAesKeyFromPhrase,
  wrapKey,
  publicKeyHexFromMasterKey,
} from '../../src/services/vault';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import type { Snapshot } from '../../src/services/questions';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

const MAYOR_KEY = PrivateKey.fromHex('77'.repeat(32));
const EPIC_ID = 'mw-demo';
const BEAD_ID = 'mw-demo.1';
const QUESTION_TEXT = 'Ship the login change?';
const RECOMMENDED = 'A';
const OPTIONS = ['A', 'B'];

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
        title: 'The demo epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [{ id: BEAD_ID, title: QUESTION_TEXT, asked_at: now, recommended: RECOMMENDED, options: OPTIONS }],
        landed: [],
        working: [],
        closed_count: 0,
      },
    ],
  };
}

test('the project view demo: a fake snapshot and question, answered and broadcast', async ({ page }) => {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  const mayorPublicKeyHex = MAYOR_KEY.toPublicKey().toString();
  const snapshotBase64 = encryptSnapshot(needsYouSnapshot(), publicKeyHex);

  let broadcastRawtx: string | undefined;

  await page.route('**/snapshot', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: snapshotBase64 }),
  );
  await page.route('**/api/utxos/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, height: 100 }] }),
    }),
  );
  await page.route('**/api/broadcast', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { rawtx: string };
    broadcastRawtx = body.rawtx;
    const tx = Transaction.fromHex(body.rawtx);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ txid: tx.id('hex') }) });
  });

  // A first visit opens PosternDB with its real schema (Dexie auto-creates it on
  // the first table read) so the seed below writes into a database shaped exactly
  // as the app itself would leave it — never a hand-rolled duplicate of db.ts.
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

  // Each screen below is its own page load (a plain <a href>, per src/App.tsx's
  // query-string routing), so the unlocked key never survives the navigation —
  // every screen unlocks the vault fresh with the same recovery phrase.
  async function unlock(): Promise<void> {
    await page.getByLabel('Recovery phrase').fill(mnemonic);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }

  // Projects screen: fetch, decrypt and render the fake snapshot.
  await page.goto('/?screen=projects');
  await unlock();
  const epicRow = page.getByTestId('epic-row');
  await expect(epicRow).toContainText('The demo epic');
  await expect(epicRow).toContainText('Needs you 1');

  // Project screen: the question is listed under Needs you.
  await epicRow.getByRole('link').first().click();
  await unlock();
  await expect(page.getByRole('heading', { name: 'The demo epic' })).toBeVisible();
  const needsYouRow = page.getByTestId('needs-you-row');
  await expect(needsYouRow).toContainText(QUESTION_TEXT);

  // Bead / Question screen: the question, its recommendation, its options and Play.
  await needsYouRow.getByRole('link').first().click();
  await unlock();
  await expect(page.getByText(QUESTION_TEXT).first()).toBeVisible();
  await expect(page.getByText(`Recommended: ${RECOMMENDED}`)).toBeVisible();
  await expect(page.getByTestId(`option-${OPTIONS[0]}`)).toBeVisible();
  await expect(page.getByTestId(`option-${OPTIONS[1]}`)).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();

  // Tapping the recommended option sends and broadcasts the §6 reply.
  await page.getByTestId(`option-${RECOMMENDED}`).click();
  await expect(page.getByText(/^Sent\. Transaction id:/)).toBeVisible();

  expect(broadcastRawtx).toBeDefined();
  const tx = Transaction.fromHex(broadcastRawtx!);
  const decoded = decodeRecordScript(tx.outputs[0].lockingScript);
  expect(decoded).not.toBeNull();
  const payload = JSON.parse(Utils.toUTF8(decoded!.payloadBytes)) as MessagePayload;
  expect(JSON.parse(decryptMessage(payload, MAYOR_KEY.toHex()))).toEqual({ bead: BEAD_ID, answer: RECOMMENDED });

  await shot(page, 'project-view');
});
