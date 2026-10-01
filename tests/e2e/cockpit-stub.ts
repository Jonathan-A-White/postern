// tests/e2e/cockpit-stub.ts — the cockpit e2e's shared setup: a seeded vault and
// a stubbed v2 backend (docs/protocol.md §9–§15) serving tests/support/cockpit-fixture.ts.
// With `voice`, the fixture's voice note is a real encrypted blob the page can play.
import { createHash } from 'node:crypto';
import { expect, type Page, type Route } from '@playwright/test';
import { PrivateKey } from '@bsv/sdk';
import { deriveMasterKey, deriveAesKeyFromPhrase, wrapKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { sealDocument } from '../../src/services/documents';
import { encryptAttachment } from '../../src/services/messages';
import type { Need, View, ViewBead } from '../../src/model/view';
import { MAYOR, fixtureDetail, fixtureRecords, fixtureView, longOptionRecords } from '../support/cockpit-fixture';

export async function seedVault(page: Page, mnemonic: string): Promise<string> {
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

function withNeeds(view: View, needs: Need[] = [], beads: ViewBead[] = []): View {
  return { ...view, needs: [...view.needs, ...needs], beads: [...view.beads, ...beads] };
}

export interface StubExtras {
  /** What /api/me names as `collections`: a cockpit key's; leave unset for an app key's answer. */
  collections?: Array<{ name: string; app?: string }>;
  /** The satoshis /api/utxos/{address} lists as one coin; unset lists none. */
  utxoSatoshis?: number;
  /** Needs added to the fixture's view (mw-tbx1n.8: cards that wait on the Mayor or the factory). */
  needs?: Need[];
  /** Beads added to the fixture's view (mw-f758y.30: grillings and maps). */
  beads?: ViewBead[];
  /** Adds the long-option decision cards of mw-gq6.172 to bead mw-2rbm.6's thread. */
  longOptions?: boolean;
}

export async function stubBackend(
  page: Page,
  governor: PrivateKey,
  voice?: { bytes: Uint8Array; mime: string },
  extras: StubExtras = {},
): Promise<{ posted: string[] }> {
  const governorPub = governor.toPublicKey().toString();
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(withNeeds(fixtureView(now), extras.needs, extras.beads)), MAYOR.toHex(), governorPub);
  let voiceAttachment: { hash: string; size: number; mime: string } | undefined;
  let voiceCiphertext: Uint8Array | undefined;
  if (voice) {
    voiceCiphertext = encryptAttachment({ bytes: voice.bytes, senderPrivateKeyHex: governor.toHex(), recipientPublicKeyHex: MAYOR.toPublicKey().toString() });
    voiceAttachment = { hash: createHash('sha256').update(voiceCiphertext).digest('hex'), size: voice.bytes.length, mime: voice.mime };
  }
  const records = fixtureRecords(governor, now, voiceAttachment);
  if (extras.longOptions) records.push(...longOptionRecords(governor, now, records.length));
  const posted: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/challenge', (route) => json(route, { nonce: 'a'.repeat(64) }));
  await page.route('**/api/me', (route) =>
    json(route, {
      pubkey: governorPub,
      mayor: MAYOR.toPublicKey().toString(),
      network: 'testnet',
      features: ['direct', 'events', 'view', 'beads', 'me'],
      ...(extras.collections ? { collections: extras.collections } : {}),
    }),
  );
  await page.route('**/api/utxos/**', (route) =>
    json(route, { utxos: extras.utxoSatoshis ? [{ txid: 'a'.repeat(64), vout: 0, satoshis: extras.utxoSatoshis, height: 100 }] : [] }),
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
  await page.route('**/api/blobs/**', (route) =>
    voiceCiphertext && route.request().url().endsWith(`/api/blobs/${voiceAttachment?.hash}`) ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(voiceCiphertext) }) : json(route, { error: 'expired' }, 404),
  );
  await page.route('**/snapshot', (route) => route.fulfill({ status: 404, body: 'not found' }));
  return { posted };
}
