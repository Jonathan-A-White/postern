import { db, type MessageClass, type MessageRow } from '../db';
import { sameMessage } from '../../model/twins';

/** The Talk line's turns (docs/protocol.md §20) and call records (§21) are records of their own:
 * every list of messages, every thread and every unread count below leaves them out. */
const notTalk = (row: MessageRow) => row.class !== 'talk' && row.class !== 'call';

/** An events batch (§22) is the factory's changes for the projector, never a message (mw-jrx0s.22):
 * it is never stored, and a row some older build stored is hidden here and removed when the app opens. */
const isMessage = (row: MessageRow) => row.class !== 'events';

/** A live card (§24) is kept as a row but is no message: no list, thread, unread count or search hit shows it (it is read from the cards table). */
const isCard = (row: MessageRow) => row.class === 'card' || row.class === 'card-update';

/** What a list may show: a message, which is neither an events batch nor a card record. */
const listed = (row: MessageRow) => isMessage(row) && !isCard(row);

/** Whether a message belongs to a thread. A missing or null thread is the general thread (Factory), as the
 * channel list groups it (`row.thread ?? GENERAL`), so the list and the channel agree on Factory's posts. */
const inThreadKey = (row: MessageRow, key: string | undefined) => (key === undefined ? row.thread == null : row.thread === key);

/** Every stored row, oldest first (by ts, then id). Dexie reads a table in one call when nothing filters it; a
 * `.filter()` makes it walk a cursor, a round trip to Chrome's database process for every message held, which holds
 * the screen on his phone (mw-gq6.718, the class of mw-gq6.712). So the rows come whole and the callers pick in memory. */
const heldOldestFirst = (): Promise<MessageRow[]> => db.messages.orderBy('ts').toArray();

/** The rows of one class, from the class index (schema v13), oldest first. */
const ofClass = async (cls: MessageClass): Promise<MessageRow[]> => (await db.messages.where('class').equals(cls).toArray()).sort(byTime);

const byTime = (a: MessageRow, b: MessageRow) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The rows an unread count and a mark-read both mean: received, not yet read, in a list (never the Talk line's or a card). */
const unreadMessage = (row: MessageRow) => listed(row) && notTalk(row) && row.direction === 'received' && !row.read;

export const messagesRepo = {
  async getAll(): Promise<MessageRow[]> {
    return (await heldOldestFirst()).filter(listed).reverse();
  },

  /** Every stored row that can be decrypted, cards included: what a later unlock reads again. */
  async getAllStored(): Promise<MessageRow[]> {
    return (await heldOldestFirst()).filter(isMessage).reverse();
  },

  /** Every message but the Talk line's turns, oldest first — the order a conversation reads in. */
  async getAllOldestFirst(): Promise<MessageRow[]> {
    return (await heldOldestFirst()).filter((row) => listed(row) && notTalk(row));
  },

  /** The Talk line's turns alone, oldest first. */
  async talkTurns(): Promise<MessageRow[]> {
    return ofClass('talk');
  },

  /** The call records and the Talk line's turns, oldest first: what says whether a Call me has been answered. */
  async callLine(): Promise<MessageRow[]> {
    const [turns, calls] = await Promise.all([ofClass('talk'), ofClass('call')]);
    return [...turns, ...calls].sort(byTime);
  },

  /** One thread's messages, oldest first; undefined is the general thread. */
  async inThread(key: string | undefined): Promise<MessageRow[]> {
    return (await heldOldestFirst()).filter((row) => listed(row) && notTalk(row) && inThreadKey(row, key));
  },

  /** The same messages as `inThread`, picked from rows already in memory (oldest first, as `getAllOldestFirst` hands them). */
  heldInThread(rows: readonly MessageRow[], key: string | undefined): MessageRow[] {
    return rows.filter((row) => listed(row) && notTalk(row) && inThreadKey(row, key));
  },

  async get(id: string): Promise<MessageRow | undefined> {
    return db.messages.get(id);
  },

  /** The message a record's txid names (its outpoints are `${txid}:${vout}`). */
  async getByTxid(txid: string): Promise<MessageRow | undefined> {
    return db.messages.where('id').startsWith(`${txid}:`).first();
  },

  /** The stored row, under another id, that is the same message as `row` (same ciphertext, from, to and ts), if any. */
  async findTwin(row: Pick<MessageRow, 'id' | 'ciphertext' | 'from' | 'to' | 'ts'>): Promise<MessageRow | undefined> {
    if (!row.ciphertext) return undefined;
    return db.messages.where('ts').equals(row.ts).filter((other) => other.id !== row.id && sameMessage(other, row)).first();
  },

  async remove(id: string): Promise<void> {
    await db.messages.delete(id);
  },

  async put(row: MessageRow): Promise<void> {
    if (!isMessage(row)) return;
    await db.messages.put(row);
  },

  /** Says the Mayor's Talk answer was played to its end or stopped by him. */
  async markHeard(id: string): Promise<void> {
    await db.messages.update(id, { heard: true });
  },

  async markRead(id: string): Promise<void> {
    await db.messages.update(id, { read: true });
  },

  /** Marks the thread's received messages read; resolves with the txids it just marked. */
  async markThreadRead(key: string | undefined): Promise<string[]> {
    const unread = (await heldOldestFirst()).filter((row) => unreadMessage(row) && row.thread === key);
    if (unread.length > 0) await db.messages.bulkUpdate(unread.map((row) => ({ key: row.id, changes: { read: true } })));
    return unread.map((row) => row.txid);
  },

  async countUnread(): Promise<number> {
    return (await heldOldestFirst()).filter(unreadMessage).length;
  },
};
