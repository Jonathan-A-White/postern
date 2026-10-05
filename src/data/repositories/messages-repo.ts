import { db, type MessageRow } from '../db';
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

export const messagesRepo = {
  async getAll(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').reverse().filter(listed).toArray();
  },

  /** Every stored row that can be decrypted, cards included: what a later unlock reads again. */
  async getAllStored(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').reverse().filter(isMessage).toArray();
  },

  /** Every message but the Talk line's turns, oldest first — the order a conversation reads in. */
  async getAllOldestFirst(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').filter((row) => listed(row) && notTalk(row)).toArray();
  },

  /** The Talk line's turns alone, oldest first. */
  async talkTurns(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').filter((row) => row.class === 'talk').toArray();
  },

  /** The call records and the Talk line's turns, oldest first: what says whether a Call me has been answered. */
  async callLine(): Promise<MessageRow[]> {
    return db.messages.orderBy('ts').filter((row) => !notTalk(row)).toArray();
  },

  /** One thread's messages, oldest first; undefined is the general thread. */
  async inThread(key: string | undefined): Promise<MessageRow[]> {
    return db.messages
      .orderBy('ts')
      .filter((row) => listed(row) && notTalk(row) && (key === undefined ? row.thread === undefined : row.thread === key))
      .toArray();
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
    const unread = db.messages.filter((row) => listed(row) && notTalk(row) && row.direction === 'received' && !row.read && row.thread === key);
    const txids = (await unread.toArray()).map((row) => row.txid);
    await unread.modify({ read: true });
    return txids;
  },

  async countUnread(): Promise<number> {
    return db.messages.filter((row) => listed(row) && notTalk(row) && row.direction === 'received' && !row.read).count();
  },
};
