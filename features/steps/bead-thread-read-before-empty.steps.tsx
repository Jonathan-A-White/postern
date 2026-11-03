// features/steps/bead-thread-read-before-empty.steps.tsx — runs features/bead-thread-read-before-empty.feature
// (mw-gq6.901): the bead page, a channel and the share list's channel against a seeded Dexie, with the live line's
// state made by the test (a first sync not yet answered, failed or answered) and the phone's own read made slow or failing.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Utils } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { ChannelPosts } from '../../src/cockpit/ShareScreen';
import { navigate, useRoute } from '../../src/router';
import { db } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import type { LiveState } from '../../src/services/live';
import type { View } from '../../src/model/view';

const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return { listeners, state: { status: 'connecting', me: null, reconnects: 0, syncs: 0 } as unknown };
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

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const GOVERNOR = '11'.repeat(32);
const BEAD_EMPTY = 'No conversation yet';
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
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.outbox.clear(), db.answers.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
  setKey(new Uint8Array(Utils.toArray(GOVERNOR, 'hex')));
}

async function holdBead(id: string): Promise<void> {
  const bead = { id, title: 'A story', type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
  const view = { v: 2, written_at: '2026-11-03T00:00:00Z', host: 'desktop', hosts: [], needs: [], beads: [bead] } as unknown as View;
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  const detail = { v: 2, ...bead, blocks: [], children: [], description: '', acceptance: '', comments: [] };
  await beadDetailsRepo.save({ id, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
}

function watch(empty: string): void {
  watcher = new MutationObserver(() => {
    if (document.body.textContent?.includes(empty)) sawEmpty = true;
  });
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
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

function readFailsOnce(): void {
  vi.spyOn(messagesRepo, 'inThread').mockRejectedValueOnce(new Error('The local database would not open.'));
}

const shown = (_ctx: unknown, text: string, not: string) => {
  expect(document.body).toHaveTextContent(text);
  expect(document.body).not.toHaveTextContent(not);
};
const shownLater = async (_ctx: unknown, text: string, not: string) => {
  await waitFor(() => expect(document.body).toHaveTextContent(text));
  expect(document.body).not.toHaveTextContent(not);
};
const shownSoon = async (_ctx: unknown, text: string, not: string) => {
  await waitFor(() => expect(document.body).toHaveTextContent(text));
  expect(document.body).not.toHaveTextContent(not);
};

afterAll(() => {
  watcher?.disconnect();
  cleanup();
  lock();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/bead-thread-read-before-empty.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const bead = (name: string) => {
    watch(BEAD_EMPTY);
    render(<BeadScreen id={name} />);
  };
  const channel = (name: string) => {
    watch('Nothing said here yet');
    render(<Harness />);
    act(() => navigate({ view: 'talk', thread: `topic:${name}` }));
  };
  const share = (name: string) => {
    render(<ChannelPosts thread={{ key: `topic:${name}`, title: name, subtitle: '', unread: 0, archived: false }} onPick={() => undefined} />);
  };

  Scenario("mw-gq6.901 AC1: a bead page with no conversation reads Reading while the phone's own read is held back", ({ Given, And, When, Then }) => {
    Given('the phone holds the bead {string} and nothing in its conversation and the backend has answered', async (_ctx, id: string) => {
      await holdBead(id);
      setLive(answered);
    });
    And("the phone is slow to read the bead's posts", slowRead);
    When('the bead {string} is opened', (_ctx, id: string) => bead(id));
    Then('{string} is shown and {string} is never shown until the phone has read it', async (_ctx, text: string, not: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
      // The read has been asked and is held: the screen has had every chance to say 'empty' and the read cannot have answered.
      await readStarted;
      await act(async () => {});
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(not);
      expect(sawEmpty).toBe(false);
    });
    And('{string} is then shown', async (_ctx, text: string) => {
      act(() => releaseRead?.());
      await waitFor(() => expect(document.body).toHaveTextContent(text));
    });
  });

  Scenario('mw-gq6.901 AC3: a bead page with no conversation reads Reading until the first sync has answered', ({ Given, When, Then }) => {
    Given('the phone holds the bead {string} and nothing in its conversation and the backend has not answered yet', async (_ctx, id: string) => {
      await holdBead(id);
      setLive(notAnswered);
    });
    When('the bead {string} is opened', (_ctx, id: string) => bead(id));
    Then('{string} is shown and {string} is not', async (_ctx, text: string, not: string) => {
      await waitFor(() => expect(document.body).toHaveTextContent(text));
      shown(_ctx, text, not);
      await new Promise((resolve) => setTimeout(resolve, 300));
      shown(_ctx, text, not);
    });
    When('the backend answers', () => setLive(answered));
    Then('it then reads {string} and not {string}', shownSoon);
  });

  Scenario('mw-gq6.901 AC2: a bead page says plainly when the backend could not be reached', ({ Given, When, Then }) => {
    Given('the phone holds the bead {string} and nothing in its conversation and the first sync has failed', async (_ctx, id: string) => {
      await holdBead(id);
      setLive(failed);
    });
    When('the bead {string} is opened', (_ctx, id: string) => bead(id));
    Then('{string} is shown and {string} is not', shownSoon);
  });

  Scenario('mw-gq6.901 AC2: a bead page whose local read fails says so and then retries it', ({ Given, And, When, Then }) => {
    Given('the phone holds the bead {string} and nothing in its conversation and the backend has answered', async (_ctx, id: string) => {
      await holdBead(id);
      setLive(answered);
    });
    And("the phone's read of the bead's posts fails once", readFailsOnce);
    When('the bead {string} is opened', (_ctx, id: string) => bead(id));
    Then('{string} is shown and {string} is not', shownSoon);
    And('it then reads {string} and not {string}', shownLater);
  });

  Scenario('mw-gq6.901 AC4: a channel whose local read fails says so and then retries it', ({ Given, And, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has answered', () => setLive(answered));
    And("the phone's read of the channel's posts fails once", readFailsOnce);
    When('the channel {string} is opened', (_ctx, name: string) => channel(name));
    Then('{string} is shown and {string} is not', shownSoon);
    And('it then reads {string} and not {string}', shownLater);
  });

  Scenario("mw-gq6.901 AC4: the share list's channel whose local read fails says so and then retries it", ({ Given, And, When, Then }) => {
    Given('the phone holds nothing in the channel {string} and the backend has answered', () => setLive(answered));
    And("the phone's read of the channel's posts fails once", readFailsOnce);
    When('the share list shows the channel {string}', (_ctx, name: string) => share(name));
    Then('{string} is shown and {string} is not', shownSoon);
    And('it then reads {string} and not {string}', shownLater);
  });
});
