// The Talk unread guards (mw-xhtcup.11): a thread's unread count and how it drops once
// the thread is read, the Talk tab's badge (the sum over threads), the '· new' marker on a
// received row, and opening a thread marking it read.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from '../../src/cockpit/Shell';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { Conversation } from '../../src/cockpit/Conversation';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { mergeConversation } from '../../src/model/conversation';
import { summariseThreads } from '../../src/model/threads';
import { indexView } from '../../src/model/tree';
import { navigate, useRoute } from '../../src/router';
import { markThreadSeen } from '../../src/services/seen';
import { fixtureView } from '../support/cockpit-fixture';

const BEAD = 'mw-f758y.30.2';
const BEAD_TITLE = 'GET /api/events streams message and view changes';
const BEAD_KEY = `bead:${BEAD}`;
const TOPIC_KEY = 'topic:launch plan';

let sequence = 0;
function row(thread: string | undefined, over: Partial<MessageRow> = {}): MessageRow {
  sequence += 1;
  const txid = `${'ab'.repeat(31)}${String(sequence).padStart(2, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1_000 + sequence,
    ciphertext: '',
    plaintext: `Message ${sequence}`,
    direction: 'received',
    read: false,
    thread,
    ...over,
  };
}

async function seed(rows: MessageRow[]): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const r of rows) await messagesRepo.put(r);
}

beforeEach(async () => {
  cleanup();
  sequence = 0;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
});

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

// A stand-in for App's routing.
function Harness() {
  const route = useRoute();
  return <Shell route={route}>{route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : <div>Elsewhere</div>}</Shell>;
}

const talkBadge = () => within(screen.getByRole('navigation', { name: 'Places' })).getByRole('link', { name: /Channels/ });
const listRow = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

describe('a thread\'s unread count', () => {
  it('counts the received rows not yet seen, and is 0 after the thread is marked seen', async () => {
    const rows = [row(BEAD_KEY), row(BEAD_KEY), row(BEAD_KEY, { read: true }), row(BEAD_KEY, { direction: 'sent', read: false }), row(TOPIC_KEY)];
    await seed(rows);
    const index = indexView(fixtureView());
    const countOf = async (key: string) => summariseThreads(await messagesRepo.getAllOldestFirst(), index).find((t) => t.key === key)?.unread;

    expect(await countOf(BEAD_KEY)).toBe(2);
    await markThreadSeen(BEAD_KEY);
    expect(await countOf(BEAD_KEY)).toBe(0);
    // Another thread's unread is untouched by reading this one.
    expect(await countOf(TOPIC_KEY)).toBe(1);
  });
});

describe('the Talk tab badge', () => {
  it('is the sum of every thread\'s unread, and drops as threads are read', async () => {
    await seed([row(BEAD_KEY), row(BEAD_KEY), row(TOPIC_KEY), row(undefined), row(undefined, { read: true })]);
    window.history.replaceState(null, '', '/?v=needs');
    render(<Harness />);
    await waitFor(() => expect(within(talkBadge()).getByText('4')).toBeInTheDocument());

    await act(() => markThreadSeen(BEAD_KEY));
    await waitFor(() => expect(within(talkBadge()).getByText('2')).toBeInTheDocument());

    await act(() => markThreadSeen(TOPIC_KEY));
    await act(() => markThreadSeen(undefined));
    await waitFor(() => expect(within(talkBadge()).queryByText(/^\d+$/)).toBeNull());
  });
});

describe('the \'· new\' marker', () => {
  const itemsOf = (rows: MessageRow[]) => mergeConversation(rows);

  it('marks a received row not yet seen and not a seen one', () => {
    render(<Conversation items={itemsOf([row(BEAD_KEY, { plaintext: 'Unseen words' }), row(BEAD_KEY, { plaintext: 'Seen words', read: true })])} />);
    const bubbleOf = (text: string) => screen.getByText(text).closest('.relative')!.parentElement as HTMLElement;
    expect(within(bubbleOf('Unseen words')).getByText('· new')).toBeInTheDocument();
    expect(within(bubbleOf('Seen words')).queryByText('· new')).toBeNull();
  });

  it('does not mark his own sent row', () => {
    cleanup();
    render(<Conversation items={itemsOf([row(BEAD_KEY, { plaintext: 'Mine', direction: 'sent', read: false })])} />);
    expect(screen.queryByText('· new')).toBeNull();
  });
});

describe('opening a thread', () => {
  it('marks its rows seen, so the count on the Talk list is gone after Back', async () => {
    await seed([row(BEAD_KEY), row(BEAD_KEY), row(TOPIC_KEY)]);
    cleanup();
    render(<Harness />);
    await screen.findByTestId('thread-list');
    await waitFor(() => expect(within(listRow(BEAD_TITLE)).getByText('2')).toBeInTheDocument());

    act(() => navigate({ view: 'talk', thread: BEAD_KEY }));
    await screen.findByRole('button', { name: 'Back' });
    await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).filter((r) => r.thread === BEAD_KEY && !r.read)).toHaveLength(0));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('thread-list');
    await waitFor(() => expect(within(listRow(BEAD_TITLE)).queryByText('2')).toBeNull());
    // The thread he did not open keeps its count.
    expect(within(listRow('launch plan')).getByText('1')).toBeInTheDocument();
    expect(within(talkBadge()).getByText('1')).toBeInTheDocument();
  });
});
