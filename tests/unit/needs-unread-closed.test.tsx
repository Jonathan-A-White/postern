// mw-mr4xgrw.55: Needs you's 'Unread from the Mayor' does not list a thread whose bead is closed (or gone from
// the view) and quiet for 7 days; it stays unread in Channels. 'Mark all read' marks every listed thread read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { forgetLastKnown } from '../../src/cockpit/lastKnown';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { summariseThreads } from '../../src/model/threads';
import { indexView } from '../../src/model/tree';
import { fixtureView } from '../support/cockpit-fixture';

const CLOSED = 'bead:mw-f758y.30.1'; // closed in the fixture view
const OPEN = 'bead:mw-f758y.30.2'; // in progress in the fixture view
const GONE = 'bead:mw-long-gone.1'; // not in the view at all
const DAY = 86_400;

const nowS = () => Math.floor(Date.now() / 1000);
let sequence = 0;
function row(thread: string, ts: number, over: Partial<MessageRow> = {}): MessageRow {
  sequence += 1;
  const txid = `${'cd'.repeat(31)}${String(sequence).padStart(2, '0')}`;
  return {
    id: `${txid}:0`, txid, vout: 0, seq: sequence, class: 'message', to: '02'.padEnd(66, '0'), from: '03'.padEnd(66, '0'),
    ts, ciphertext: '', plaintext: `Words ${sequence}`, direction: 'received', read: false, thread, ...over,
  };
}

async function seed(rows: MessageRow[]): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const r of rows) await messagesRepo.put(r);
}

const unreadSection = () => screen.queryByRole('region', { name: 'Unread from the Mayor' });

beforeEach(async () => {
  cleanup();
  forgetLastKnown();
  sequence = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.messages.clear(), db.answers.clear(), db.cards.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
});

afterEach(() => cleanup());

describe('Unread from the Mayor and closed beads', () => {
  it('does not list a closed or gone bead\'s thread quiet for 8 days, still lists an open one and a closed one heard from today', async () => {
    await seed([
      row(CLOSED, nowS() - 8 * DAY, { plaintext: 'Old closed words' }),
      row(GONE, nowS() - 8 * DAY, { plaintext: 'Old gone words' }),
      row(OPEN, nowS() - 8 * DAY, { plaintext: 'Old open words' }),
    ]);
    await messagesRepo.put(row(CLOSED, nowS() - 60, { plaintext: 'Fresh closed words' }));
    render(<NeedsScreen />);
    const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
    expect(within(section).getByText('Fresh closed words')).toBeInTheDocument();
    expect(within(section).getByText('Old open words')).toBeInTheDocument();
    expect(within(section).queryByText('Old gone words')).toBeNull();
  });

  it('lists no section when the only unread thread is a closed bead\'s, 8 days quiet; its badge stays in Channels', async () => {
    await seed([row(CLOSED, nowS() - 8 * DAY), row(CLOSED, nowS() - 9 * DAY)]);
    render(<NeedsScreen />);
    await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).length).toBe(2));
    await screen.findByRole('region', { name: 'Waiting on you' });
    expect(unreadSection()).toBeNull();
    const threads = summariseThreads(await messagesRepo.getAllOldestFirst(), indexView(fixtureView()));
    expect(threads.find((t) => t.key === CLOSED)?.unread).toBe(2);
  });

  it('Mark all read marks every listed thread read and the section goes', async () => {
    await seed([row(OPEN, nowS() - 60), row('topic:launch plan', nowS() - 120), row(OPEN, nowS() - 30)]);
    render(<NeedsScreen />);
    const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
    fireEvent.click(within(section).getByRole('button', { name: 'Mark all read' }));
    await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).filter((r) => !r.read)).toHaveLength(0));
    await waitFor(() => expect(unreadSection()).toBeNull());
  });

  it('Mark all read leaves a hidden old closed thread unread', async () => {
    await seed([row(OPEN, nowS() - 60), row(CLOSED, nowS() - 9 * DAY)]);
    render(<NeedsScreen />);
    const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
    fireEvent.click(within(section).getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(unreadSection()).toBeNull());
    const left = (await messagesRepo.getAllOldestFirst()).filter((r) => !r.read);
    expect(left.map((r) => r.thread)).toEqual([CLOSED]);
  });
});
