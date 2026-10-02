// mw-nqur1n.11: live cards (docs/protocol.md §24) — the decoders, the fold of a card with its
// updates, the rule that says which event ticks an item, and the store: a card record is kept
// as a row, read into the cards table, and is never a message in a list or an unread.
import { describe, it, expect, beforeEach } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db, type CardRow, type EventRow } from '../../src/data/db';
import { cardsRepo, messagesRepo } from '../../src/data/repositories';
import { decodeCard, decodeCardUpdate, liveCard, meetsExpectation, ticksFrom } from '../../src/model/cards';
import { tickFromEvents } from '../../src/services/cards';
import { decryptPendingMessages, storeRecord } from '../../src/services/inbox';
import { encryptMessage } from '../../src/services/messages';

const ME = PrivateKey.fromHex('44'.repeat(32));
const MAYOR = PrivateKey.fromHex('77'.repeat(32));
const T0 = 1_790_000_000;

const CARD = JSON.stringify({
  title: 'Top 5',
  prompt: 'top5',
  thread: { bead: 'mw-t.1' },
  items: [
    { n: 1, text: 'VERIFIED on mw-a.1', links: ['mw-a.1'], expect: { bead: 'mw-a.1', state: 'verified' } },
    { n: 2, text: 'Release mw-b.1', links: [], expect: { bead: 'mw-b.1', state: 'open' } },
  ],
  subscribe: { kinds: ['bead_changed'], beads: ['mw-a.1', 'mw-b.1'] },
});

function event(seq: number, bead: string, to: string, ts = new Date((T0 + seq) * 1000).toISOString(), kind = 'bead_changed'): EventRow {
  return { seq, ts, kind, bead, actor: 'mw', from: '', to, detail: '', lane: 'normal' };
}

function move(bead: string, from: string, to: string, seq = 1, ts = new Date((T0 + seq) * 1000).toISOString()): EventRow {
  return { seq, ts, kind: 'bead_changed', bead, actor: 'mw', from, to, detail: '', lane: 'normal' };
}

function row(overrides: Partial<CardRow> = {}): CardRow {
  return { id: 'cc', card: decodeCard(CARD, T0), updates: [], ticks: {}, ...overrides };
}

describe('decoding', () => {
  it('reads the card the Mayor sends, and leaves out an item with no number or text', () => {
    const card = decodeCard(JSON.stringify({ title: 'T', items: [{ n: 1, text: 'one' }, { n: 0, text: 'bad' }, { text: 'no number' }, { n: 3 }], subscribe: {} }), T0);
    expect(card?.items).toEqual([{ n: 1, text: 'one', links: [] }]);
    expect(card?.subscribe).toEqual({ kinds: [], beads: [] });
  });

  it('drops an expectation that names a state the app does not know', () => {
    const card = decodeCard(JSON.stringify({ title: 'T', items: [{ n: 1, text: 'x', expect: { bead: 'b', state: 'sideways' } }] }), T0);
    expect(card?.items[0].expect).toBeUndefined();
  });

  it('refuses plaintext that is not a card, or an update that names no card', () => {
    expect(decodeCard('plain words', T0)).toBeUndefined();
    expect(decodeCard(JSON.stringify({ items: [] }), T0)).toBeUndefined();
    expect(decodeCardUpdate(JSON.stringify({ tick: [1] }))).toBeUndefined();
    expect(decodeCardUpdate(JSON.stringify({ re: 'cc', links: { 2: ['b'] }, tick: [1, 'x'] }))).toEqual({ re: 'cc', items: [], links: { '2': ['b'] }, tick: [1] });
  });
});

describe('liveCard', () => {
  it('applies the updates in the order sent: items replaced by number, links merged, ticks set', () => {
    const update = (txid: string, seq: number, rest: object) => ({ txid, seq, ts: T0 + seq, items: [], links: {}, tick: [], ...rest });
    const card = liveCard(
      row({
        updates: [
          update('u2', 2, { items: [{ n: 2, text: 'Release mw-b.2', links: ['mw-b.2'] }, { n: 3, text: 'new', links: [] }] }),
          update('u1', 1, { links: { '2': ['mw-b.1'] }, tick: [1] }),
          update('u3', 3, { links: { '2': ['mw-b.2', 'mw-x.1'] } }),
        ],
      }),
    );
    expect(card?.items.map((item) => item.n)).toEqual([1, 2, 3]);
    expect(card?.items[0]).toMatchObject({ done: true, doneAt: (T0 + 1) * 1000 });
    // u1 added mw-b.1 to the item, then u2 replaced the whole item, then u3 added to the replacement.
    expect(card?.items[1]).toMatchObject({ text: 'Release mw-b.2', links: ['mw-b.2', 'mw-x.1'], done: false });
    expect(card?.subscribe.beads).toEqual(expect.arrayContaining(['mw-a.1', 'mw-b.1', 'mw-b.2', 'mw-x.1']));
  });

  it('holds updates that page in before their card and shows nothing until it arrives', () => {
    expect(liveCard({ id: 'cc', updates: [{ txid: 'u1', seq: 1, ts: T0, items: [], links: {}, tick: [1] }], ticks: {} })).toBeUndefined();
  });

  it('is done only when every item is, by an update or by the app\'s own tick', () => {
    expect(liveCard(row({ ticks: { '1': 5 } }))?.done).toBe(false);
    const done = liveCard(row({ ticks: { '1': 5 }, updates: [{ txid: 'u', seq: 1, ts: T0, items: [], links: {}, tick: [2] }] }));
    expect(done?.done).toBe(true);
    expect(done?.items.map((item) => item.doneAt)).toEqual([5, T0 * 1000]);
  });

  it('asks for card_answered when an item expects an answer', () => {
    const card = liveCard(row({ updates: [{ txid: 'u', seq: 1, ts: T0, items: [{ n: 3, text: 'Answer mw-q.1', links: [], expect: { bead: 'mw-q.1', state: 'answered' } }], links: {}, tick: [] }] }));
    expect(card?.subscribe.kinds).toEqual(expect.arrayContaining(['bead_changed', 'card_answered']));
  });
});

describe('which event ticks an item', () => {
  it('is the bead moving to the state; landed is met by landed, verified or closed, closed by closed, verified only by verified', () => {
    const verified = { bead: 'b', state: 'verified' };
    expect(meetsExpectation(verified, event(1, 'b', 'verified'))).toBe(true);
    expect(meetsExpectation(verified, event(1, 'b', 'closed'))).toBe(false);
    expect(meetsExpectation(verified, event(1, 'b', 'landed'))).toBe(false);
    expect(meetsExpectation(verified, event(1, 'other', 'verified'))).toBe(false);
    const landed = { bead: 'b', state: 'landed' };
    expect(meetsExpectation(landed, move('b', 'running', 'landed'))).toBe(true);
    expect(meetsExpectation(landed, move('b', 'running', 'closed'))).toBe(true);
    expect(meetsExpectation(landed, move('b', 'landed', 'verified'))).toBe(true);
    expect(meetsExpectation(landed, move('b', 'running', 'claimed'))).toBe(false);
    const closed = { bead: 'b', state: 'closed' };
    expect(meetsExpectation(closed, move('b', 'landed', 'closed'))).toBe(true);
    expect(meetsExpectation(closed, move('b', 'landed', 'verified'))).toBe(false);
    expect(meetsExpectation(closed, move('b', 'running', 'landed'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'open' }, event(1, 'b', 'closed'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'open' }, event(1, 'b', 'open'))).toBe(true);
  });

  it('is never an event whose from equals its to: a comment is no state move', () => {
    expect(meetsExpectation({ bead: 'b', state: 'verified' }, move('b', 'closed', 'closed'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'verified' }, move('b', 'verified', 'verified'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'landed' }, move('b', 'closed', 'closed'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'closed' }, move('b', 'closed', 'closed'))).toBe(false);
    expect(meetsExpectation({ bead: 'b', state: 'open' }, move('b', 'open', 'open'))).toBe(false);
  });

  it('ticks a verified item on closed to verified, and not on a detail comment or on landed to closed', () => {
    const card = liveCard(row());
    if (!card) throw new Error('no card');
    const at = (n: number) => new Date((T0 + n) * 1000).toISOString();
    const comment = move('mw-a.1', 'closed', 'closed', 1, at(5));
    const landing = move('mw-a.1', 'landed', 'closed', 2, at(6));
    expect(ticksFrom(card, [comment, landing])).toEqual({});
    const verifiedAt = move('mw-a.1', 'closed', 'verified', 3, at(10));
    expect(ticksFrom(card, [comment, landing, verifiedAt])).toEqual({ 1: (T0 + 10) * 1000 });
  });

  it('is a card_answered on the bead for an expected answer, and no bead_changed', () => {
    const answered = { bead: 'q', state: 'answered' };
    expect(meetsExpectation(answered, event(1, 'q', 'answered', undefined, 'card_answered'))).toBe(true);
    expect(meetsExpectation(answered, event(1, 'q', 'answered'))).toBe(false);
  });

  it('ignores an event from before the item was sent, and takes the first one after', () => {
    const card = liveCard(row());
    if (!card) throw new Error('no card');
    const before = event(1, 'mw-a.1', 'verified', new Date((T0 - 60) * 1000).toISOString());
    const first = event(2, 'mw-a.1', 'verified', new Date((T0 + 10) * 1000).toISOString());
    const later = event(3, 'mw-a.1', 'verified', new Date((T0 + 20) * 1000).toISOString());
    expect(ticksFrom(card, [later, before, first])).toEqual({ 1: (T0 + 10) * 1000 });
  });
});

describe('the store', () => {
  const pub = ME.toPublicKey().toString();
  const key = new Uint8Array(Utils.toArray(ME.toHex(), 'hex'));
  const seal = (messageClass: 'card' | 'card-update', text: string) => encryptMessage({ text, class: messageClass, senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: pub, ts: T0 });

  beforeEach(async () => {
    await Promise.all([db.messages.clear(), db.cards.clear(), db.events.clear(), db.settings.clear()]);
  });

  it('keeps a card as a row read into the cards table, and never as a message or an unread', async () => {
    await storeRecord({ seq: 1, txid: 'aa'.repeat(32), vout: 0, payload: seal('card', CARD) }, pub, ME.toHex());
    expect(await messagesRepo.getAll()).toEqual([]);
    expect(await messagesRepo.getAllOldestFirst()).toEqual([]);
    expect(await messagesRepo.inThread('bead:mw-t.1')).toEqual([]);
    expect(await messagesRepo.countUnread()).toBe(0);
    const held = await cardsRepo.get('aa'.repeat(32));
    expect(held?.card?.title).toBe('Top 5');
    expect(held?.thread).toBe('bead:mw-t.1');
  });

  it('keeps a repeat of the same record once, and an update before its card', async () => {
    const update = JSON.stringify({ re: 'aa'.repeat(32), links: { 2: ['mw-b.2'] } });
    await storeRecord({ seq: 2, txid: 'bb'.repeat(32), vout: 0, payload: seal('card-update', update) }, pub, ME.toHex());
    expect(liveCard((await cardsRepo.get('aa'.repeat(32))) as CardRow)).toBeUndefined();
    const record = { seq: 1, txid: 'aa'.repeat(32), vout: 0, payload: seal('card', CARD) };
    await storeRecord(record, pub, ME.toHex());
    await storeRecord(record, pub, ME.toHex());
    await storeRecord({ seq: 2, txid: 'bb'.repeat(32), vout: 0, payload: seal('card-update', update) }, pub, ME.toHex());
    const held = (await cardsRepo.get('aa'.repeat(32))) as CardRow;
    expect(held.updates).toHaveLength(1);
    expect(liveCard(held)?.items[1].links).toEqual(['mw-b.2']);
  });

  it('reads a card that arrived while the key was locked once the key unlocks', async () => {
    await storeRecord({ seq: 1, txid: 'aa'.repeat(32), vout: 0, payload: seal('card', CARD) }, pub);
    expect(await cardsRepo.getAll()).toEqual([]);
    await decryptPendingMessages(key);
    expect((await cardsRepo.get('aa'.repeat(32)))?.card?.title).toBe('Top 5');
  });

  it('ignores a card this phone sent itself', async () => {
    const mine = encryptMessage({ text: CARD, class: 'card', senderPrivateKeyHex: ME.toHex(), recipientPublicKeyHex: MAYOR.toPublicKey().toString(), ts: T0 });
    await storeRecord({ seq: 1, txid: 'aa'.repeat(32), vout: 0, payload: mine }, pub, ME.toHex());
    expect(await cardsRepo.getAll()).toEqual([]);
  });

  it('ticks from the events held, once each, with no network', async () => {
    await storeRecord({ seq: 1, txid: 'aa'.repeat(32), vout: 0, payload: seal('card', CARD) }, pub, ME.toHex());
    await db.events.bulkAdd([event(5, 'mw-a.1', 'verified'), event(6, 'mw-b.1', 'claimed')]);
    const card = liveCard((await cardsRepo.get('aa'.repeat(32))) as CardRow);
    if (!card) throw new Error('no card');
    expect(await tickFromEvents(card)).toEqual([1]);
    const after = liveCard((await cardsRepo.get('aa'.repeat(32))) as CardRow);
    expect(after?.items.map((item) => item.done)).toEqual([true, false]);
    expect(after?.items[0].doneAt).toBe(Date.parse(event(5, '', '').ts));
    // A later pass ticks nothing more, and never moves the first tick.
    if (after) expect(await tickFromEvents(after)).toEqual([]);
  });
});
