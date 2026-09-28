// tests/e2e/cockpit.spec.ts — plans/0021: the cockpit end to end in a real
// browser against a stubbed v2 backend (docs/protocol.md §9–§15), from unlock to
// every place, with one screenshot per place at whatever width the project runs
// (390 px for `npm run shots`). The fixture is tests/support/cockpit-fixture.ts.
import { test, expect, type Page, type Route } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { createMnemonic, deriveMasterKey, deriveAesKeyFromPhrase, wrapKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { sealDocument } from '../../src/services/documents';
import { MAYOR, fixtureDetail, fixtureRecords, fixtureView } from '../support/cockpit-fixture';
import { shot } from './shot';

test.use({ serviceWorkers: 'block' });

async function seedVault(page: Page, mnemonic: string): Promise<string> {
  const key = await deriveMasterKey(mnemonic);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapped = await wrapKey(key, await deriveAesKeyFromPhrase(mnemonic, salt));
  const publicKeyHex = publicKeyHexFromMasterKey(key);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Set up your key' })).toBeVisible();
  await page.evaluate(
    ({ ciphertext, iv, salt: saltBytes, publicKeyHex: pub }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['vault'], 'readwrite');
          tx.objectStore('vault').put({
            id: 'default',
            mode: 'phrase',
            ciphertext: new Uint8Array(ciphertext).buffer,
            iv: new Uint8Array(iv),
            salt: new Uint8Array(saltBytes),
            prfFallbackReason: 'webauthn-unavailable',
            publicKeyHex: pub,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { ciphertext: Array.from(new Uint8Array(wrapped.ciphertext)), iv: Array.from(wrapped.iv), salt: Array.from(salt), publicKeyHex },
  );
  return publicKeyHex;
}

async function stubBackend(page: Page, governor: PrivateKey): Promise<{ posted: string[] }> {
  const governorPub = governor.toPublicKey().toString();
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(fixtureView(now)), MAYOR.toHex(), governorPub);
  const records = fixtureRecords(governor, now);
  const posted: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/challenge', (route) => json(route, { nonce: 'a'.repeat(64) }));
  await page.route('**/api/me', (route) =>
    json(route, { pubkey: governorPub, mayor: MAYOR.toPublicKey().toString(), network: 'testnet', features: ['direct', 'events', 'view', 'beads', 'me'] }),
  );
  await page.route('**/api/view', (route) => route.fulfill({ status: 200, contentType: 'text/plain', headers: { ETag: '"fixture"' }, body: view }));
  await page.route('**/api/events', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: hello\ndata: {"head": ${records.length}, "view": "\\"fixture\\""}\n\n` }),
  );
  await page.route('**/api/messages**', async (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postData() ?? '');
      return json(route, { txid: `direct:${'e'.repeat(64)}`, seq: records.length + posted.length }, 201);
    }
    return json(route, { records, next: records.length });
  });
  await page.route('**/api/beads/**', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const detail = fixtureDetail(id, now);
    if (!detail) return json(route, { error: 'no such bead' }, 404);
    return route.fulfill({ status: 200, contentType: 'text/plain', body: await sealDocument(JSON.stringify(detail), MAYOR.toHex(), governorPub) });
  });
  await page.route('**/api/blobs/**', (route) => json(route, { error: 'expired' }, 404));
  await page.route('**/snapshot', (route) => route.fulfill({ status: 404, body: 'not found' }));
  return { posted };
}

test('the cockpit: unlock, needs, map, epic, bead, talk, search, me', async ({ page }) => {
  const mnemonic = createMnemonic();
  const governorKeyBytes = await deriveMasterKey(mnemonic);
  const governor = PrivateKey.fromHex(Buffer.from(governorKeyBytes).toString('hex'));
  const { posted } = await stubBackend(page, governor);
  await seedVault(page, mnemonic);

  await page.goto('/');
  await shot(page, 'cockpit-unlock');
  await page.getByLabel('Recovery phrase').fill(mnemonic);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByTestId('need-card').first()).toContainText('Where should the BSV library live?');
  await expect(page.getByText('Unread from the Mayor')).toBeVisible();
  await shot(page, 'cockpit-needs');

  await page.getByRole('button', { name: 'New repo bsv-kit (recommended)' }).click();
  await expect.poll(() => posted.length).toBe(1);

  await page.goto('/?v=map');
  await expect(page.getByTestId('epic-card').first()).toBeVisible();
  await shot(page, 'cockpit-map');

  await page.goto('/?v=map&focus=mw-f758y.30&lens=board');
  await expect(page.getByTestId('board')).toBeVisible();
  await shot(page, 'cockpit-epic-board');

  await page.goto('/?v=map&focus=mw-f758y.30&lens=graph');
  await expect(page.getByTestId('graph')).toBeVisible();
  await shot(page, 'cockpit-epic-graph');

  await page.goto('/?v=bead&id=mw-f758y.30.2');
  await expect(page.getByText('Acceptance criteria')).toBeVisible();
  await expect(page.getByText('Make the ping interval 25 seconds', { exact: false })).toBeVisible();
  await shot(page, 'cockpit-bead');

  await page.goto('/?v=talk');
  await expect(page.getByTestId('thread-list')).toBeVisible();
  await shot(page, 'cockpit-talk');

  await page.goto('/?v=talk&t=general');
  await expect(page.getByText('Overnight', { exact: false })).toBeVisible();
  await shot(page, 'cockpit-thread');

  await page.goto('/?v=search&q=ping');
  await expect(page.getByTestId('hits-bead').or(page.getByTestId('hits-message')).first()).toBeVisible();
  await shot(page, 'cockpit-search');

  await page.goto('/?v=me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  await shot(page, 'cockpit-me');
});
