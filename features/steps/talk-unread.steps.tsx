// features/steps/talk-unread.steps.tsx — runs features/talk-unread.feature (mw-xhtcup.11):
// the Talk list's unread against a seeded Dexie and a view, no network.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
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
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-f758y.30.2';
const BEAD_KEY = `bead:${BEAD}`;
const BEAD_TITLE = 'GET /api/events streams message and view changes';
const TOPIC_KEY = 'topic:launch plan';

let sequence = 0;
let seeded: MessageRow[] = [];
let unreadCount: number | undefined;
let titles: string[] = [];

function row(thread: string | undefined, over: Partial<MessageRow> = {}): MessageRow {
  sequence += 1;
  const txid = `${'cd'.repeat(31)}${String(sequence).padStart(2, '0')}`;
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

const unseen = (thread: string | undefined, n: number) => Array.from({ length: n }, () => row(thread));
const keyOf = (id: string) => `bead:${id}`;

async function store(): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const r of seeded) await messagesRepo.put(r);
}

async function unreadOf(key: string): Promise<number | undefined> {
  const index = indexView(fixtureView());
  return summariseThreads(await messagesRepo.getAllOldestFirst(), index).find((thread) => thread.key === key)?.unread;
}

// A stand-in for App's routing.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return <Shell route={route}>{route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : <div>Elsewhere</div>}</Shell>;
}

const tab = () => within(screen.getByRole('navigation', { name: 'Places' })).getByRole('link', { name: /Channels/ });
const listRow = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-unread.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    sequence = 0;
    seeded = [];
    unreadCount = undefined;
    titles = [];
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear()]);
    window.history.replaceState(null, '', '/?v=talk');
  });

  Scenario("AC-1: a thread's unread count is the received rows not yet seen, and drops to 0 once the thread is read", ({ Given, When, Then }) => {
    Given('the bead thread {string} holds 2 received rows he has not seen, one he has, and one he sent', async (_c, id: string) => {
      seeded = [...unseen(keyOf(id), 2), row(keyOf(id), { read: true }), row(keyOf(id), { direction: 'sent' })];
      await store();
    });
    When("the thread's unread count is read", async () => {
      unreadCount = await unreadOf(BEAD_KEY);
    });
    Then('the count is 2', () => {
      expect(unreadCount).toBe(2);
    });
    When('he reads the bead thread {string}', async (_c, id: string) => {
      await markThreadSeen(keyOf(id));
    });
    Then("the bead thread's count is 0", async () => {
      expect(await unreadOf(BEAD_KEY)).toBe(0);
    });
  });

  Scenario("AC-2: the Talk tab badge is the sum of every thread's unread and falls as threads are read", ({ Given, When, Then }) => {
    Given('a bead thread holds 2 unseen rows, a channel {string} holds 1 and the Factory thread holds 1', async () => {
      seeded = [...unseen(BEAD_KEY, 2), ...unseen(TOPIC_KEY, 1), ...unseen(undefined, 1), row(undefined, { read: true })];
      await store();
    });
    When('the cockpit is open on another place', () => {
      window.history.replaceState(null, '', '/?v=needs');
      render(<Harness />);
    });
    Then('the Talk tab badge reads {string}', async (_c, count: string) => {
      await waitFor(() => expect(within(tab()).getByText(count)).toBeInTheDocument());
    });
    When('he reads the bead thread {string}', async (_c, id: string) => {
      await act(() => markThreadSeen(keyOf(id)));
    });
    Then('the Talk tab badge now reads {string}', async (_c, count: string) => {
      await waitFor(() => expect(within(tab()).getByText(count)).toBeInTheDocument());
    });
    When('he reads the channel {string} and the Factory thread', async () => {
      await act(() => markThreadSeen(TOPIC_KEY));
      await act(() => markThreadSeen(undefined));
    });
    Then('the Talk tab shows no badge', async () => {
      await waitFor(() => expect(within(tab()).queryByText(/^\d+$/)).toBeNull());
    });
  });

  Scenario("AC-3: a received row not yet seen shows '· new' and a seen one does not", ({ Given, When, Then, And }) => {
    Given('a conversation holds a received row {string} he has not seen and one {string} he has', (_c, unseenText: string, seenText: string) => {
      seeded = [row(BEAD_KEY, { plaintext: unseenText }), row(BEAD_KEY, { plaintext: seenText, read: true })];
    });
    When('the conversation is shown', () => {
      render(<Conversation items={mergeConversation(seeded)} />);
    });
    Then('the row {string} shows {string}', (_c, text: string, marker: string) => {
      expect(within(bubble(text)).getByText(marker)).toBeInTheDocument();
    });
    And('the row {string} shows no {string}', (_c, text: string, marker: string) => {
      expect(within(bubble(text)).queryByText(marker)).toBeNull();
    });
  });

  Scenario('AC-4: opening a thread marks it seen, so its count is gone from the Talk list after Back', ({ Given, When, Then, And }) => {
    Given('the Talk list shows the bead thread {string} with 2 unseen rows and a channel {string} with 1', async () => {
      seeded = [...unseen(BEAD_KEY, 2), ...unseen(TOPIC_KEY, 1)];
      await store();
      render(<Harness />);
      await screen.findByTestId('thread-list');
      await waitFor(() => expect(within(listRow(BEAD_TITLE)).getByText('2')).toBeInTheDocument());
    });
    When('he opens the bead thread and goes Back', async () => {
      act(() => navigate({ view: 'talk', thread: BEAD_KEY }));
      await screen.findByRole('button', { name: 'Back' });
      await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).filter((r) => r.thread === BEAD_KEY && !r.read)).toHaveLength(0));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await screen.findByTestId('thread-list');
    });
    Then("the bead thread's row shows no count", async () => {
      await waitFor(() => expect(within(listRow(BEAD_TITLE)).queryByText('2')).toBeNull());
    });
    And('the channel {string} still shows its count of 1', (_c, name: string) => {
      expect(within(listRow(name)).getByText('1')).toBeInTheDocument();
    });
  });

  Scenario("AC-5: a thread is titled by the view's bead title, the bead id when the view lacks it, or the channel's name", ({ Given, When, Then }) => {
    Given('the view names the bead {string} {string}', () => {
      seeded = [row(BEAD_KEY, { ts: 3_000 }), row('bead:mw-nowhere.9', { ts: 2_000 }), row(TOPIC_KEY, { ts: 1_000 })];
    });
    When('the Talk list is built for the bead thread, a bead thread the view does not hold, and a channel {string}', () => {
      titles = summariseThreads(seeded, indexView(fixtureView()))
        .filter((thread) => thread.key !== 'general')
        .map((thread) => thread.title);
    });
    Then('the titles are the bead\'s title, {string} and {string}', (_c, id: string, name: string) => {
      expect(titles).toEqual([BEAD_TITLE, id, name]);
    });
  });
});

/** The message bubble's block (bubble and its '· new' line) holding this text. */
function bubble(text: string): HTMLElement {
  return screen.getByText(text).closest('.relative')!.parentElement as HTMLElement;
}
