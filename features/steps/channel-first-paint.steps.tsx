// features/steps/channel-first-paint.steps.tsx — runs features/channel-first-paint.feature
// (mw-gq6.265): the Talk screen against a seeded Dexie, the channel read made slow so the
// first paint of an opened channel is what the phone already held, never the empty state.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act, waitFor, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { navigate, useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const EMPTY = 'Nothing said here yet';
const SLOW_MS = 400;
let sequence = 0;
let seeded: MessageRow[] = [];
let sawEmpty = false;
let watcher: MutationObserver | undefined;

function post(text: string, thread: string | undefined | null): MessageRow {
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
    ts: 1_760_000_000 + sequence * 60,
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
    ...(thread === undefined ? {} : { thread: thread as string }),
  };
}

async function fresh(): Promise<void> {
  cleanup();
  vi.restoreAllMocks();
  watcher?.disconnect();
  sequence = 0;
  seeded = [];
  sawEmpty = false;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

// A stand-in for App's routing: Talk on whatever the URL names.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
}

async function listOpen(): Promise<void> {
  cleanup();
  window.history.replaceState(null, '', '/?v=talk');
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  await db.messages.bulkPut(seeded);
  render(<Harness />);
  // The list is built from the messages the screen holds: wait for them before opening anything.
  await screen.findByTestId('thread-list');
  await waitFor(() => expect(screen.getByTestId('thread-list').textContent).toContain(seeded[0].plaintext));
}

function slowRead(): void {
  const real = messagesRepo.inThread.bind(messagesRepo);
  vi.spyOn(messagesRepo, 'inThread').mockImplementation(async (key) => {
    const rows = await real(key);
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    return rows;
  });
}

function opened(key: string): void {
  watcher = new MutationObserver(() => {
    if (document.body.textContent?.includes(EMPTY)) sawEmpty = true;
  });
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
  act(() => navigate({ view: 'talk', thread: key }));
}

const shownAtOnce = (_ctx: unknown, text: string) => {
  expect(screen.getByTestId('conversation')).toHaveTextContent(text);
};

afterAll(() => {
  watcher?.disconnect();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/channel-first-paint.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-gq6.265 AC1: Factory opens with its posts on the first paint while the phone is still reading', ({ Given, And, When, Then }) => {
    Given('the phone holds the Factory post {string}', (_ctx, text: string) => {
      seeded.push(post(text, undefined));
    });
    And('the Channels list is open', listOpen);
    And("the phone is slow to read one channel's posts", slowRead);
    When('Factory is opened from the list', () => opened('general'));
    Then('{string} is shown at once', shownAtOnce);
    And('{string} is never shown', async () => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
      expect(sawEmpty).toBe(false);
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.265 AC1: a bead channel opens with its posts on the first paint while the phone is still reading', ({ Given, And, When, Then }) => {
    Given('the phone holds the post {string} in the channel of bead {string}', (_ctx, text: string, bead: string) => {
      seeded.push(post(text, `bead:${bead}`));
    });
    And('the Channels list is open', listOpen);
    And("the phone is slow to read one channel's posts", slowRead);
    When('the channel of bead {string} is opened from the list', (_ctx, bead: string) => opened(`bead:${bead}`));
    Then('{string} is shown at once', shownAtOnce);
    And('{string} is never shown', async () => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
      expect(sawEmpty).toBe(false);
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });
  });

  Scenario("mw-gq6.265 AC2: a Factory post stored with a null thread is in the list's preview and in the Factory pane", ({ Given, And, When, Then }) => {
    Given('the phone holds the Factory post {string} stored with a null thread', (_ctx, text: string) => {
      seeded.push(post(text, null));
    });
    And('the Channels list is open', listOpen);
    Then('the Factory row previews {string}', (_ctx, text: string) => {
      expect(screen.getByTestId('thread-list')).toHaveTextContent(text);
    });
    When('Factory is opened from the list', () => opened('general'));
    Then('{string} is shown once the phone has read the channel', async (_ctx, text: string) => {
      await waitFor(() => expect(screen.getByTestId('conversation')).toHaveTextContent(text));
    });
  });

  Scenario('mw-gq6.265 AC3: a channel with no posts still says Nothing said here yet', ({ Given, And, When, Then }) => {
    Given('the phone holds the Factory post {string}', (_ctx, text: string) => {
      seeded.push(post(text, undefined));
    });
    And('the Channels list is open', listOpen);
    When('the named channel {string} is opened from the list', (_ctx, name: string) => opened(`topic:${name}`));
    Then('{string} is shown once the phone has read the channel', async (_ctx, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });
});
