// features/steps/thread-read-before-empty.steps.tsx — runs features/thread-read-before-empty.feature
// (mw-gq6.898): the Talk screen against a seeded Dexie, with the live line's state made by the test
// (a first sync not yet answered, failed or answered) and the phone's own read made slow.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { navigate, useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import type { LiveState } from '../../src/services/live';

const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    state: { status: 'connecting', me: null, reconnects: 0, syncs: 0 } as unknown,
  };
});

vi.mock('../../src/services/live', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/live')>();
  return {
    ...real,
    useLive: () =>
      useSyncExternalStore(
        (listener) => {
          fake.listeners.add(listener);
          return () => fake.listeners.delete(listener);
        },
        () => fake.state as LiveState,
      ),
  };
});

const EMPTY = 'Nothing said here yet';

let sawEmpty = false;
// The held read: slowRead() makes it, the scenario releases it (no timer decides when the phone has read).
let releaseRead: (() => void) | undefined;
let readStarted: Promise<void> = Promise.resolve();
let watcher: MutationObserver | undefined;

function setLive(state: Partial<LiveState>): void {
  act(() => {
    fake.state = { status: 'connecting', me: null, reconnects: 0, syncs: 0, ...state };
    for (const listener of fake.listeners) listener();
  });
}

const notAnswered = { status: 'connecting' } as const;
const failed = { status: 'offline', error: 'The backend did not answer.', reached: false, syncs: 1 } as const;
const answered = { status: 'live', reached: true, answered: 1, syncs: 1 } as const;

async function fresh(): Promise<void> {
  cleanup();
  vi.restoreAllMocks();
  watcher?.disconnect();
  releaseRead?.();
  releaseRead = undefined;
  sawEmpty = false;
  setLive(notAnswered);
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
}

function opened(name: string, root?: string): void {
  watcher = new MutationObserver(() => {
    if (document.body.textContent?.includes(EMPTY)) sawEmpty = true;
  });
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
  render(<Harness />);
  act(() => navigate({ view: 'talk', thread: `topic:${name}`, ...(root ? { root } : {}) }));
}

function slowRead(): void {
  const real = messagesRepo.inThread.bind(messagesRepo);
  const held = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let started!: () => void;
  readStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(messagesRepo, 'inThread').mockImplementation(async (key) => {
    const rows = await real(key);
    started();
    await held;
    return rows;
  });
}

const conversation = () => document.body;
const shownNot = (_ctx: unknown, shown: string, not: string) => {
  expect(conversation()).toHaveTextContent(shown);
  expect(conversation()).not.toHaveTextContent(not);
};
const shownThen = async (_ctx: unknown, shown: string, not: string) => {
  await waitFor(() => expect(conversation()).toHaveTextContent(shown));
  expect(conversation()).not.toHaveTextContent(not);
};

afterAll(() => {
  watcher?.disconnect();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/thread-read-before-empty.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario("mw-gq6.898 AC1: an empty channel reads Reading while the phone's own read is held back", ({ Given, And, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has answered', () => setLive(answered));
    And("the phone is slow to read one channel's posts", slowRead);
    When('the channel {string} is opened', (_ctx, name: string) => opened(name));
    Then('{string} is shown and {string} is never shown until the phone has read it', async (_ctx, shown: string, not: string) => {
      expect(await screen.findByText(shown)).toBeInTheDocument();
      // The read has been asked and is held: the screen has had every chance to say 'empty' and the read cannot have answered.
      await readStarted;
      await act(async () => {});
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(not)).not.toBeInTheDocument();
      expect(sawEmpty).toBe(false);
    });
    And('{string} is then shown', async (_ctx, text: string) => {
      act(() => releaseRead?.());
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.898 AC1: an empty channel reads Reading until the first sync has answered', ({ Given, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has not answered yet', () => setLive(notAnswered));
    When('the channel {string} is opened', (_ctx, name: string) => opened(name));
    Then('{string} is shown and {string} is not', async (_ctx, shown: string, not: string) => {
      await waitFor(() => expect(conversation()).toHaveTextContent(shown));
      shownNot(_ctx, shown, not);
      await new Promise((resolve) => setTimeout(resolve, 300));
      shownNot(_ctx, shown, not);
    });
    When('the backend answers', () => setLive(answered));
    Then('it then reads {string} and not {string}', shownThen);
  });

  Scenario('mw-gq6.898 AC1: an empty channel says plainly that the backend could not be reached', ({ Given, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the first sync has failed', () => setLive(failed));
    When('the channel {string} is opened', (_ctx, name: string) => opened(name));
    Then('{string} is shown and {string} is not', shownThen);
    When('the backend answers', () => setLive(answered));
    Then('it then reads {string} and not {string}', shownThen);
  });

  Scenario('mw-gq6.898 AC1: the posts arrive when the sync answers and replace the Reading line', ({ Given, When, And, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has not answered yet', () => setLive(notAnswered));
    When('the channel {string} is opened', (_ctx, name: string) => opened(name));
    And('the sync brings the post {string} and the backend answers', async (_ctx, text: string) => {
      const txid = 'cd'.repeat(32);
      const row: MessageRow = {
        id: `${txid}:0`, txid, vout: 0, seq: 1, class: 'message', to: '02'.padEnd(66, '0'), from: '03'.padEnd(66, '0'),
        ts: 1_760_000_000, ciphertext: '', plaintext: text, direction: 'received', read: true, thread: 'topic:quiet',
      };
      await db.messages.put(row);
      setLive(answered);
    });
    Then('it then reads {string} and not {string}', shownThen);
  });

  Scenario('mw-gq6.898 AC1: a reply thread whose post is not held yet reads Reading, not that the post is missing', ({ Given, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has not answered yet', () => setLive(notAnswered));
    When('the reply thread of a post in the channel {string} is opened', (_ctx, name: string) => opened(name, 'ef'.repeat(32)));
    Then('{string} is shown and {string} is not', async (_ctx, shown: string, not: string) => {
      await waitFor(() => expect(conversation()).toHaveTextContent(shown));
      expect(conversation()).not.toHaveTextContent(not);
    });
  });
});
