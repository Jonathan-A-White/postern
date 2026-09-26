// tests/e2e/threads.spec.ts — mw-f758y.21.3: the Threads screen lists a topic
// thread and shows its message, at a 390px phone width. A fake vault is seeded
// straight into IndexedDB (the same approach as tests/e2e/compose.spec.ts);
// GET /api/messages is stubbed with one message naming a topic thread.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, deriveAesKeyFromPhrase, wrapKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { encryptMessage } from '../../src/services/messages';
import { encodeThreadedMessage } from '../../src/services/threads';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const MAYOR_KEY = PrivateKey.fromHex('55'.repeat(32));

test('the Threads screen lists a topic thread and its message', async ({ page }) => {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  const mayorPublicKeyHex = MAYOR_KEY.toPublicKey().toString();

  const payload = encryptMessage({
    text: encodeThreadedMessage({ thread: { topic: 'launch plan' }, text: 'ready when you are' }),
    class: 'message',
    senderPrivateKeyHex: MAYOR_KEY.toHex(),
    recipientPublicKeyHex: publicKeyHex,
  });

  // Every authenticated /api call signs a fresh nonce from GET /api/challenge first
  // (src/services/apiAuth.ts, since mw-f758y.22.2); without this stub the challenge
  // request falls through to the preview server's index.html and syncMessages fails
  // silently, leaving the thread list empty.
  await page.route('**/api/challenge', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nonce: 'a'.repeat(64) }) }),
  );
  await page.route('**/api/messages**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ records: [{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload }], next: 1 }),
    }),
  );
  await page.route('**/snapshot', (route) => route.fulfill({ status: 404, body: 'not found' }));

  // A first visit opens PosternDB with its real schema (Dexie auto-creates it on
  // the first table read) so the seed below writes into a database shaped exactly
  // as the app itself would leave it.
  await page.goto('/?screen=threads');
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

  await page.goto('/?screen=threads');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByText('launch plan')).toBeVisible();

  await shot(page, 'threads');
});
