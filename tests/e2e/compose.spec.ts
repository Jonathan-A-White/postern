// tests/e2e/compose.spec.ts — mw-tfne4.15: the Governor's phone showed the
// Mayor's public key overflowing the screen, with white showing beside the
// slate-900 background. A fake vault and recipient key are seeded straight into
// IndexedDB (the same approach as project-view.spec.ts), then the Send screen is
// loaded at a 390px phone width to prove the key wraps and nothing overflows.
import { test, expect } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, deriveAesKeyFromPhrase, wrapKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { shot } from './shot';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const MAYOR_KEY = PrivateKey.fromHex('44'.repeat(32));

test('the Mayor\'s public key wraps at a 390px width instead of overflowing the screen', async ({ page }) => {
  const mnemonic = createMnemonic();
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
  const wrapped = await wrapKey(key, aesKey);
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  const mayorPublicKeyHex = MAYOR_KEY.toPublicKey().toString();

  // A first visit opens PosternDB with its real schema (Dexie auto-creates it on
  // the first table read) so the seed below writes into a database shaped exactly
  // as the app itself would leave it.
  await page.goto('/?screen=compose');
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

  await page.goto('/?screen=compose');
  const keyElement = page.getByText(mayorPublicKeyHex);
  await expect(keyElement).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

  const viewportSize = page.viewportSize();
  const box = await keyElement.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportSize!.width);

  await shot(page, 'compose');
});
