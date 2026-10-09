// mw-v1uyku.1: the rule that archives a live card untouched for 48 h, and the store that never deletes one.
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type CardRow, type MessageRow } from '../../src/data/db';
import { cardsRepo } from '../../src/data/repositories';
import { CARD_ARCHIVE_AFTER_MS, isArchived, lastTouched, mentionedAt, splitArchive } from '../../src/model/cardArchive';
import { decodeCard, liveCard, type LiveCard } from '../../src/model/cards';

const HOUR = 3_600_000;
const SENT = 1_790_000_000; // Unix seconds
const SENT_MS = SENT * 1000;

const CARD = JSON.stringify({
  title: 'Top 5',
  thread: { bead: 'mw-t.1' },
  items: [
    { n: 1, text: 'one', links: ['mw-a.1'], expect: { bead: 'mw-a.1', state: 'verified' } },
    { n: 2, text: 'two', links: [] },
  ],
  subscribe: { kinds: ['bead_changed'], beads: ['mw-a.1'] },
});

function row(overrides: Partial<CardRow> = {}): CardRow {
  return { id: 'cc', thread: 'bead:mw-t.1', card: decodeCard(CARD, SENT), updates: [], ticks: {}, ...overrides };
}

function card(overrides: Partial<CardRow> = {}): LiveCard {
  return liveCard(row(overrides)) as LiveCard;
}

function message(overrides: Partial<MessageRow>): MessageRow {
  return { id: 'm:0', txid: 'm', vout: 0, seq: 1, class: 'message', to: 'a', from: 'b', ts: SENT, ciphertext: '', plaintext: 'hello', direction: 'received', read: true, ...overrides };
}

describe('the archive rule', () => {
  it('is 48 hours, in one place', () => {
    expect(CARD_ARCHIVE_AFTER_MS).toBe(48 * HOUR);
  });

  it('keeps a card sent 47 h ago and archives one sent 49 h ago', () => {
    expect(isArchived(card(), [], SENT_MS + 47 * HOUR)).toBe(false);
    expect(isArchived(card(), [], SENT_MS + 49 * HOUR)).toBe(true);
  });

  it('counts an update, a held tick, a tick in the record and a tap as a touch', () => {
    const at = SENT_MS + 60 * HOUR;
    const now = SENT_MS + 61 * HOUR;
    const update = { txid: 'u', seq: 1, ts: at / 1000, items: [], links: {}, tick: [] };
    expect(isArchived(card({ updates: [update] }), [], now)).toBe(false);
    expect(isArchived(card({ ticks: { 1: at } }), [], now)).toBe(false);
    expect(isArchived(card({ updates: [{ ...update, tick: [2] }] }), [], now)).toBe(false);
    expect(isArchived(card({ touchedAt: at }), [], now)).toBe(false);
    expect(isArchived(card(), [], now)).toBe(true);
  });

  it('counts a message in the card bead\'s thread, or one that names a bead it links, as a touch', () => {
    const now = SENT_MS + 60 * HOUR;
    const at = (now - HOUR) / 1000;
    expect(mentionedAt(card(), [message({ thread: 'bead:mw-t.1', ts: at })])).toBe(at * 1000);
    expect(mentionedAt(card(), [message({ plaintext: 'a screenshot of mw-a.1', ts: at })])).toBe(at * 1000);
    expect(isArchived(card(), [message({ thread: 'bead:mw-t.1', ts: at })], now)).toBe(false);
    expect(lastTouched(card(), [message({ plaintext: 'mw-a.1', ts: at })])).toBe(at * 1000);
  });

  it('finds a bead id standing alone, not as the start of another id', () => {
    const at = SENT + 59 * 3600;
    for (const plaintext of ['see mw-a.10', 'mw-a.1.2 landed', 'xmw-a.1', 'mw-a.1x']) expect(mentionedAt(card(), [message({ plaintext, ts: at })])).toBe(0);
    for (const plaintext of ['see mw-a.1.', '(mw-a.1)', 'mw-a.1, mw-a.2', 'mw-a.1\nnext']) expect(mentionedAt(card(), [message({ plaintext, ts: at })])).toBe(at * 1000);
  });

  it('ignores a message about other beads, and a card, update, event or Talk turn', () => {
    const at = SENT + 59 * 3600;
    expect(mentionedAt(card(), [message({ thread: 'bead:mw-z.9', plaintext: 'mw-z.9', ts: at })])).toBe(0);
    for (const cls of ['card', 'card-update', 'events', 'talk', 'call'] as const) {
      expect(mentionedAt(card(), [message({ class: cls, plaintext: 'mw-a.1', thread: 'bead:mw-t.1', ts: at })])).toBe(0);
    }
  });

  it('splits the cards, archived ones newest touch first', () => {
    const old = { ...card(), id: 'old' };
    const older = { ...card(), id: 'older', touchedAt: SENT_MS - 10 * HOUR };
    const young = { ...card(), id: 'young', touchedAt: SENT_MS + 50 * HOUR };
    const split = splitArchive([older, young, old], [], SENT_MS + 52 * HOUR);
    expect(split.fresh.map((c) => c.id)).toEqual(['young']);
    expect(split.archived.map((c) => c.id)).toEqual(['old', 'older']);
  });
});

describe('the store', () => {
  beforeEach(async () => {
    await db.cards.clear();
  });

  it('never deletes a card: archiving is a view, and the row stays with its updates and ticks', async () => {
    await db.cards.put(row({ ticks: { 1: SENT_MS + HOUR } }));
    expect(isArchived(card(), [], SENT_MS + 500 * HOUR)).toBe(true);
    expect(await cardsRepo.getAll()).toHaveLength(1);
    expect(await cardsRepo.get('cc')).toMatchObject({ ticks: { 1: SENT_MS + HOUR } });
  });

  it('records a tap on a link as a touch, never an earlier one, and nothing for a card it does not hold', async () => {
    await cardsRepo.touch('missing');
    expect(await db.cards.count()).toBe(0);
    await db.cards.put(row({ touchedAt: Date.now() + 5 * HOUR }));
    await cardsRepo.touch('cc');
    expect((await cardsRepo.get('cc'))?.touchedAt).toBeGreaterThan(Date.now() + 4 * HOUR);
    await db.cards.put(row());
    await cardsRepo.touch('cc');
    expect((await cardsRepo.get('cc'))?.touchedAt).toBeGreaterThan(Date.now() - 60_000);
  });
});
