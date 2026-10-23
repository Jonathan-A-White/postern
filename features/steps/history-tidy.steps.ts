// features/steps/history-tidy.steps.ts — runs features/history-tidy.feature (mw-gq6.718): the real Dexie store with
// its cursor stepping at his phone's pace (tests/support/phone-cursor.ts), the real tidyHistory and the real banner read.
import { afterAll, afterEach, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db, type EventRow, type MessageRow } from '../../src/data/db';
import { EVENTS_KEPT, tidyHistory } from '../../src/data/tidy';
import { eventsRepo, messagesRepo } from '../../src/data/repositories';
import { twinsToDrop } from '../../src/model/twins';
import { cursorStepsTaken, phonePaceCursors } from '../../tests/support/phone-cursor';

const LONG = EVENTS_KEPT + 500;
const MESSAGES = 400;
/** A walk of 400 messages is 400 steps; an index read and a bulk delete take a handful. */
const A_FEW_STEPS = 20;

function event(seq: number, lane: string, fields: Partial<EventRow> = {}): EventRow {
  return { seq, ts: '2026-10-01T12:00:00Z', kind: 'bead_changed', bead: `mw-x.${seq % 50}`, actor: 'mw@laptop', from: 'open', to: 'closed', detail: `d${seq}`, lane, ...fields };
}

function message(n: number, cls: MessageRow['class']): MessageRow {
  return { id: `${cls}:${n}:0`, txid: `${cls}:${n}`, vout: 0, seq: n, class: cls, to: 'me', from: 'mayor', ts: n, ciphertext: `ct${n}`, plaintext: 'Hello.', direction: 'received', read: true };
}

const THREAD = 'bead:mw-x.1';

/** Plain, Talk, call and card rows interleaved in time; every third plain one is in THREAD, and the received ones are unread. */
function longConversation(): MessageRow[] {
  const classes: MessageRow['class'][] = ['message', 'message', 'talk', 'call', 'card', 'message'];
  return Array.from({ length: MESSAGES }, (_, i) => {
    const cls = classes[i % classes.length];
    return { ...message(i + 1, cls), ts: 1000 + Math.floor(i / 2), thread: i % 3 === 0 ? THREAD : undefined, read: i % 2 === 0, direction: i % 4 === 0 ? 'sent' : 'received' } as MessageRow;
  });
}

const TWIN_PAIRS = 100;
const TWIN_MESSAGES = 20_000;

/** TWIN_MESSAGES rows in which TWIN_PAIRS * 3 answers are each also held under a chain txid (a third of them first, a third twice over). */
function twinned(): MessageRow[] {
  const rows: MessageRow[] = [];
  const copy = (row: MessageRow, txid: string): MessageRow => ({ ...row, id: `${txid}:0`, txid });
  for (let i = 0; i < TWIN_PAIRS * 3; i += 1) {
    const base = message(i + 1, 'message');
    const direct = copy(base, `direct:${i}`);
    if (i % 3 === 0) rows.push(copy(base, `chain:${i}`), direct);
    else if (i % 3 === 1) rows.push(direct, copy(base, `chain:${i}`));
    else rows.push(direct, copy(base, `chain:${i}`), copy(base, `chain:${i}b`));
  }
  const held = rows.length;
  for (let n = 1; rows.length < TWIN_MESSAGES + (held - TWIN_PAIRS * 3); n += 1) rows.push(message(10_000 + n, 'message'));
  return rows;
}

let restore: (() => void) | undefined;

async function fresh(): Promise<void> {
  restore?.();
  restore = undefined;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.events.clear()]);
}

async function tidyAtHisPace(): Promise<void> {
  restore = phonePaceCursors(1);
  await tidyHistory();
}

afterEach(() => {
  restore?.();
  restore = undefined;
});
afterAll(fresh);

const feature = await loadFeature('features/history-tidy.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-gq6.718 AC-1: a long history of events is cut to the newest when the app is shown, every emergency stays, at his phone\'s pace', ({ Given, When, Then, And }) => {
    Given('the phone holds a long history of events, all projected, and two emergencies among the oldest, one tapped away', async () => {
      const rows = [event(1, 'emergency', { to: 'failed', detail: 'Disk is full' }), event(2, 'emergency', { to: 'failed', detail: 'Boost is down' })];
      for (let seq = 3; seq <= LONG; seq += 1) rows.push(event(seq, seq % 3 === 0 ? 'fallback' : 'normal'));
      await db.events.bulkAdd(rows);
      await eventsRepo.setCursor(LONG);
      await eventsRepo.clearEmergency(1);
    });
    When('the app is shown and tidies its history, at his phone\'s pace', tidyAtHisPace);
    Then('only the newest events and both emergencies are held', async () => {
      const seqs = (await db.events.orderBy('seq').keys()) as number[];
      expect(seqs).toHaveLength(EVENTS_KEPT + 2);
      expect(seqs.slice(0, 2)).toEqual([1, 2]);
      expect(seqs[2]).toBe(LONG - EVENTS_KEPT + 1);
      expect(seqs[seqs.length - 1]).toBe(LONG);
    });
    And('the banner still shows the emergency he has not tapped away', async () => {
      expect((await eventsRepo.latestEmergency())?.detail).toBe('Boost is down');
      expect(await eventsRepo.emergencyCount()).toBe(2);
    });
    And('the tidying took only a few steps of a cursor', () => {
      expect(cursorStepsTaken()).toBeLessThan(A_FEW_STEPS);
    });
  });

  Scenario('mw-gq6.718 AC-1: events the phone has not projected yet are not cut, however many there are', ({ Given, When, Then }) => {
    Given('the phone holds a long history of events, none projected yet', async () => {
      const rows: EventRow[] = [];
      for (let seq = 1; seq <= LONG; seq += 1) rows.push(event(seq, 'normal'));
      await db.events.bulkAdd(rows);
      await eventsRepo.setCursor(0);
    });
    When('the app is shown and tidies its history, at his phone\'s pace', tidyAtHisPace);
    Then('every event is still held', async () => {
      expect(await db.events.count()).toBe(LONG);
    });
  });

  Scenario('mw-gq6.718 AC-2: removing the events rows an older build stored does not walk every message', ({ Given, When, Then, And }) => {
    Given('the phone holds a long history of messages and two rows an older build stored from events records', async () => {
      const rows: MessageRow[] = [];
      for (let n = 1; n <= MESSAGES; n += 1) rows.push(message(n, n % 5 === 0 ? 'talk' : 'message'));
      rows.push(message(MESSAGES + 1, 'events'), message(MESSAGES + 2, 'events'));
      await db.messages.bulkAdd(rows);
    });
    When('the app is shown and tidies its history, at his phone\'s pace', tidyAtHisPace);
    Then('the stored events rows are gone and every message is still held', async () => {
      expect((await db.messages.toArray()).filter((row) => row.class === 'events')).toEqual([]);
      expect(await db.messages.count()).toBe(MESSAGES);
    });
    And('the tidying took only a few steps of a cursor', () => {
      expect(cursorStepsTaken()).toBeLessThan(A_FEW_STEPS);
    });
  });

  Scenario('mw-gq6.718 AC-3: the lists of messages and the unread count are read without a cursor step for every message held', ({ Given, When, Then, And }) => {
    const rows = longConversation();
    const lists: Record<string, string[]> = {};
    let unread = 0;
    let marked: string[] = [];
    Given('the phone holds a long history of messages: plain, in threads, Talk turns, call records and cards, some unread', async () => {
      await db.messages.bulkAdd(rows);
    });
    When('every list of messages, the Talk line, the unread count and a thread being read are asked for, at his phone\'s pace', async () => {
      restore = phonePaceCursors(1);
      const ids = (found: MessageRow[]) => found.map((row) => row.id);
      lists.all = ids(await messagesRepo.getAll());
      lists.stored = ids(await messagesRepo.getAllStored());
      lists.oldest = ids(await messagesRepo.getAllOldestFirst());
      lists.talk = ids(await messagesRepo.talkTurns());
      lists.call = ids(await messagesRepo.callLine());
      lists.thread = ids(await messagesRepo.inThread(THREAD));
      lists.general = ids(await messagesRepo.inThread(undefined));
      unread = await messagesRepo.countUnread();
      marked = await messagesRepo.markThreadRead(THREAD);
    });
    Then('each list holds the rows it always held, in its own order, and the unread rows of the thread are marked read', async () => {
      const byTs = [...rows].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
      const listed = (row: MessageRow) => row.class !== 'card' && row.class !== 'card-update';
      const plain = (row: MessageRow) => listed(row) && row.class !== 'talk' && row.class !== 'call';
      const unreadPlain = (row: MessageRow) => plain(row) && row.direction === 'received' && !row.read;
      const ids = (found: MessageRow[]) => found.map((row) => row.id);
      expect(lists.stored).toEqual(ids([...byTs].reverse()));
      expect(lists.all).toEqual(ids([...byTs].reverse().filter(listed)));
      expect(lists.oldest).toEqual(ids(byTs.filter(plain)));
      expect(lists.talk).toEqual(ids(byTs.filter((row) => row.class === 'talk')));
      expect(lists.call).toEqual(ids(byTs.filter((row) => row.class === 'talk' || row.class === 'call')));
      expect(lists.thread).toEqual(ids(byTs.filter((row) => plain(row) && row.thread === THREAD)));
      expect(lists.general).toEqual(ids(byTs.filter((row) => plain(row) && row.thread == null)));
      expect(unread).toBe(rows.filter(unreadPlain).length);
      expect(marked.sort()).toEqual(rows.filter((row) => unreadPlain(row) && row.thread === THREAD).map((row) => row.txid).sort());
      expect((await db.messages.toArray()).filter((row) => unreadPlain(row) && row.thread === THREAD)).toEqual([]);
    });
    And('the reading took only a few steps of a cursor', () => {
      expect(cursorStepsTaken()).toBeLessThan(A_FEW_STEPS);
    });
  });

  Scenario('mw-gq6.719 AC-1: a reply held direct and on chain is told from the rest by one look at each message, and the direct copy stays', ({ Given, When, Then, And }) => {
    let tableReads = 0;
    Given('the phone holds a very long history of messages, some answers held twice: on chain first, direct first, and a third copy', async () => {
      await db.messages.bulkAdd(twinned());
    });
    When('the app is shown and tidies its history, at his phone\'s pace', async () => {
      const reads = vi.spyOn(db.messages, 'toArray');
      await tidyAtHisPace();
      tableReads = reads.mock.calls.length;
      reads.mockRestore();
    });
    Then('every answer held twice is held once, the direct copy, and every other message is still held', async () => {
      const held = await db.messages.toArray();
      expect(held).toHaveLength(TWIN_MESSAGES);
      expect(held.filter((row) => row.txid.startsWith('chain:'))).toEqual([]);
      expect(held.filter((row) => row.txid.startsWith('direct:')).map((row) => row.id).sort()).toEqual(
        Array.from({ length: TWIN_PAIRS * 3 }, (_, i) => `direct:${i}:0`).sort(),
      );
    });
    And('the twin step read the table once and took only a few steps of a cursor', () => {
      expect(tableReads).toBe(1);
      expect(cursorStepsTaken()).toBeLessThan(A_FEW_STEPS);
    });
  });

  Scenario('mw-gq6.719 AC-2: finding the twins among twenty thousand messages takes a fraction of a second', ({ Given, When, Then }) => {
    let rows: MessageRow[] = [];
    let dropped: MessageRow[] = [];
    let ms = Infinity;
    Given('the phone holds twenty thousand messages, a few of them twins', () => {
      rows = Array.from({ length: 20_000 }, (_, i) => ({ ...message(i + 1, 'message'), ts: 1000 + Math.floor(i / 50) }));
      for (let i = 0; i < 20; i += 1) {
        const twin = { ...rows[i * 900] };
        rows.splice(i * 900 + 1, 0, { ...twin, id: `chain-copy:${i}:0`, txid: `chain-copy:${i}`, vout: 0 });
        rows[i * 900] = { ...twin, id: `direct:${i}:0`, txid: `direct:${i}` };
      }
    });
    When('the twins among them are asked for', () => {
      const started = performance.now();
      dropped = twinsToDrop(rows);
      ms = performance.now() - started;
    });
    Then('they are named in under 200 milliseconds, and only the chain copies', () => {
      expect(dropped.map((row) => row.id)).toEqual(Array.from({ length: 20 }, (_, i) => `chain-copy:${i}:0`));
      expect(ms).toBeLessThan(200);
    });
  });
});
