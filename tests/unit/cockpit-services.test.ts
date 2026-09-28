// plans/0021: the cockpit's services — places as URLs (old notification links
// included), the encrypted documents the Mayor writes (sealed, checked, inflated),
// who is who (§15, with the Mayor pinned on first sight), the live view kept in
// Dexie (with an old backend's snapshot as the fallback) and the event stream's
// framing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { formatRoute, isDeep, parseRoute } from '../../src/nav/route';
import { brc78Sender, openDocument, sealDocument, WrongSenderError } from '../../src/services/documents';
import { acceptOfferedMayorKey, fetchMe, LEGACY, NoLicenceError, reconcileMayorKey } from '../../src/services/me';
import { refreshView, storedView } from '../../src/services/view';
import { parseEventBlock } from '../../src/services/live';
import { db } from '../../src/data/db';
import { getMayorPublicKey } from '../../src/services/messages';
import { fixtureView, MAYOR } from '../support/cockpit-fixture';

const GOV = PrivateKey.fromHex('45'.repeat(32));
const GOV_KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('routes', () => {
  it('round-trips every place', () => {
    for (const route of [
      { view: 'needs' as const },
      { view: 'map' as const, focus: 'mw-a', lens: 'graph' as const, bucket: 'ready', filter: 'mine' },
      { view: 'bead' as const, id: 'mw-a.1' },
      { view: 'talk' as const, thread: 'bead:mw-a.1' },
      { view: 'search' as const, q: 'ping' },
      { view: 'me' as const },
      { view: 'share' as const, id: 's1' },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it('reads the old screens’ links, so a notification already delivered still lands', () => {
    expect(parseRoute('?screen=inbox')).toEqual({ view: 'needs' });
    expect(parseRoute('?screen=project&epic=mw-a')).toEqual({ view: 'map', focus: 'mw-a' });
    expect(parseRoute('?screen=thread&thread=bead%3Amw-a')).toEqual({ view: 'talk', thread: 'bead:mw-a' });
    expect(parseRoute('?screen=bead&epic=e&kind=working&bead=mw-a.2')).toEqual({ view: 'bead', id: 'mw-a.2' });
    expect(parseRoute('')).toEqual({ view: 'needs' });
  });

  it('knows which places are a step down (Back, no tab bar)', () => {
    expect(isDeep({ view: 'bead', id: 'x' })).toBe(true);
    expect(isDeep({ view: 'talk', thread: 'general' })).toBe(true);
    expect(isDeep({ view: 'talk' })).toBe(false);
    expect(isDeep({ view: 'map', focus: 'x' })).toBe(true);
  });
});

describe('documents', () => {
  it('opens what the Mayor sealed for him, gzip and all', async () => {
    const sealed = await sealDocument('{"hello":"world"}', MAYOR.toHex(), GOV_PUB);
    expect(brc78Sender(Utils.toArray(sealed, 'base64'))).toBe(MAYOR_PUB);
    expect(await openDocument(sealed, { key: GOV_KEY, mayorKey: MAYOR_PUB })).toBe('{"hello":"world"}');
  });

  it('refuses a document from anyone but the pinned Mayor', async () => {
    const forged = await sealDocument('{}', PrivateKey.fromHex('99'.repeat(32)).toHex(), GOV_PUB);
    await expect(openDocument(forged, { key: GOV_KEY, mayorKey: MAYOR_PUB })).rejects.toBeInstanceOf(WrongSenderError);
  });

  it('reads an uncompressed document as it stands', async () => {
    const plain = Utils.toBase64(EncryptedMessage.encrypt(Utils.toArray('{"a":1}', 'utf8'), MAYOR, PublicKey.fromString(GOV_PUB)));
    expect(await openDocument(plain, { key: GOV_KEY })).toBe('{"a":1}');
  });
});

describe('who is who', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('reads /api/me, calls a backend without it legacy, and a 401 no licence', async () => {
    const answer = (response: Response) => vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/challenge') ? json({ nonce: 'ab'.repeat(32) }) : response));
    expect(await fetchMe({ key: GOV_KEY, fetchImpl: answer(json({ pubkey: GOV_PUB, mayor: MAYOR_PUB, network: 'testnet', features: ['direct', 'view'] })) })).toEqual({
      pubkey: GOV_PUB,
      mayor: MAYOR_PUB,
      network: 'testnet',
      features: ['direct', 'view'],
    });
    expect(await fetchMe({ key: GOV_KEY, fetchImpl: answer(new Response('404 page not found', { status: 404 })) })).toEqual(LEGACY);
    await expect(fetchMe({ key: GOV_KEY, fetchImpl: answer(json({ error: 'no licence held' }, 401)) })).rejects.toBeInstanceOf(NoLicenceError);
  });

  it('pins the Mayor on first sight and never swaps him silently', async () => {
    expect(await reconcileMayorKey(MAYOR_PUB)).toEqual({ pinned: MAYOR_PUB });
    const other = PrivateKey.fromHex('98'.repeat(32)).toPublicKey().toString();
    expect(await reconcileMayorKey(other)).toEqual({ pinned: MAYOR_PUB, offered: other });
    expect(await getMayorPublicKey()).toBe(MAYOR_PUB);
    expect(await acceptOfferedMayorKey()).toBe(other);
    expect(await getMayorPublicKey()).toBe(other);
  });
});

describe('refreshView', () => {
  beforeEach(async () => {
    await db.view.clear();
  });

  it('stores the live view, then asks with its ETag and takes a 304 as unchanged', async () => {
    const sealed = await sealDocument(JSON.stringify(fixtureView()), MAYOR.toHex(), GOV_PUB);
    const seen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/challenge')) return json({ nonce: 'ab'.repeat(32) });
      const tag = new Headers(init?.headers).get('If-None-Match');
      seen.push(tag);
      return tag === '"v1"' ? new Response(null, { status: 304 }) : new Response(sealed, { status: 200, headers: { ETag: '"v1"' } });
    });
    expect(await refreshView({ key: GOV_KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl })).toBe('updated');
    expect(await refreshView({ key: GOV_KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl })).toBe('unchanged');
    expect(seen).toEqual([null, '"v1"']);
    expect((await storedView())?.view.host).toBe('desktop');
  });

  it("falls back to an old backend's snapshot", async () => {
    const snapshot = { written_at: 'w', epics: [{ id: 'e', title: 'E', priority: 'P2', status: 'open', needs_you: [], landed: [], working: [], closed_count: 0 }] };
    const ct = Utils.toBase64(EncryptedMessage.encrypt(Utils.toArray(JSON.stringify(snapshot), 'utf8'), MAYOR, PublicKey.fromString(GOV_PUB)));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return json({ nonce: 'ab'.repeat(32) });
      if (url.endsWith('/view')) return new Response('404 page not found', { status: 404 });
      return new Response(ct, { status: 200 });
    });
    expect(await refreshView({ key: GOV_KEY, live: true, fetchImpl, snapshotUrl: '/snapshot' })).toBe('updated');
    const stored = await storedView();
    expect(stored?.source).toBe('snapshot');
    expect(stored?.view.beads[0]).toMatchObject({ id: 'e', type: 'epic' });
  });
});

describe('parseEventBlock', () => {
  it('reads named events and skips pings', () => {
    expect(parseEventBlock('event: message\ndata: {"seq": 4}')).toEqual({ event: 'message', data: '{"seq": 4}' });
    expect(parseEventBlock('event: view\ndata: {"etag": "\\"x\\""}')).toEqual({ event: 'view', data: '{"etag": "\\"x\\""}' });
    expect(parseEventBlock(': ping')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is what install-hands-root prints: sha256 of the key hex, first 16, in fours', async () => {
    const { fingerprint } = await import('../../src/services/me');
    const key = '03f01d6b9018ab421dd410404cb869072065522bf85734008f105cf385a023a80f';
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(key).digest('hex').slice(0, 16).replace(/(.{4})(?!$)/g, '$1 ');
    expect(fingerprint(key)).toBe(expected);
    expect(fingerprint(key)).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
  });
});
