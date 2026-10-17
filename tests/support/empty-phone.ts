import { db } from '../../src/data/db';
import { settledWrites } from '../../src/services/deliver';
import { settledOutbox } from '../../src/services/outbox';

/**
 * A scenario's phone starts empty: the rows a step wrote are gone. The sender and the writes the last
 * scenario left settling (the outbox's recorded note, a sent record) are let finish first, so none lands
 * after the clear and shows on the next scenario's message (mw-8ifimx.11). Call it after the last
 * scenario's screen is unmounted and before forgetOutboxState().
 */
export async function emptyPhone(): Promise<void> {
  await settlePhone();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear(), db.beadDetails.clear(), db.answers.clear()]);
}

/**
 * The settle half of emptyPhone(), for a step file that clears its own list of tables (events, vault,
 * pendingSpends...): the sender and the write-behinds finish first. Call it before forgetOutboxState(),
 * which drops the sender's pass, and before the clear (mw-gq6.544).
 */
export async function settlePhone(): Promise<void> {
  await settledOutbox();
  await settledWrites();
}
