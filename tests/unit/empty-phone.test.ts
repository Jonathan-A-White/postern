import { describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { answersRepo, settingsRepo } from '../../src/data/repositories';
import { writeBehind } from '../../src/services/deliver';
import { emptyPhone, settlePhone } from '../support/empty-phone';

// mw-8ifimx.11: 'a text sent with the mode off has no note' saw the Recorded note of the scenario before it.
// The outbox keeps that note with a write-behind (keyed by the message's txid, which the delivery double
// gives every scenario alike); one still settling when the next scenario emptied the phone landed after the clear.
describe('emptying the phone between scenarios', () => {
  it('leaves no write of the last scenario to land after it', async () => {
    await emptyPhone();
    // a write that is still settling when the next scenario starts
    writeBehind(new Promise((resolve) => setTimeout(resolve, 30)).then(() => settingsRepo.addRecordedNote('ef'.repeat(32), 'Recorded for after 21:00')), 'that it was recorded for later');

    await emptyPhone();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await db.settings.count()).toBe(0);
  });
});

// mw-gq6.544: the step files that clear their own list of tables (events, vault, pendingSpends...) cannot call
// emptyPhone(); they settle first with settlePhone(). A delivered answer's save (the outbox's rememberDelivered,
// a write-behind) still settling when the next scenario's start() cleared db.answers landed after the clear.
describe('settling the phone before a step file clears its own tables', () => {
  it('lets the last scenario\'s answer save land before the clear, not after it', async () => {
    await emptyPhone();
    writeBehind(new Promise((resolve) => setTimeout(resolve, 30)).then(() => answersRepo.save({ bead: 'mw-x', answer: 'Yes', txid: 'direct:' + '1'.repeat(64) })), 'your answer');

    await settlePhone();
    await Promise.all([db.view.clear(), db.answers.clear(), db.outbox.clear()]);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await db.answers.count()).toBe(0);
  });
});
