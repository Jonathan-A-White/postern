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
  await settledOutbox();
  await settledWrites();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear(), db.beadDetails.clear(), db.answers.clear()]);
}
