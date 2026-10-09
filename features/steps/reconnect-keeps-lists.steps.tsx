// features/steps/reconnect-keeps-lists.steps.tsx — runs features/reconnect-keeps-lists.feature
// (mw-v1uyku.2): the real live.ts loop, the real LiveBadge and the real Talk screen against a seeded
// Dexie. The event stream is cut and the phone's reads are slow (as they are while a reconnect's sync
// is writing), and he leaves Channels and comes back: what the phone holds is still on the screen.
// Only the network (apiFetch, the syncs, the /me answer) is a double; the backoff runs on fake timers.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { navigate, useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import { forgetLastKnown } from '../../src/cockpit/lastKnown';

const net = vi.hoisted(() => ({ stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined }));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        net.stream = controller;
      },
    }),
  })),
}));
vi.mock('../../src/services/inbox', () => ({ syncMessages: vi.fn(async () => ({ events: [] })) }));
vi.mock('../../src/services/view', () => ({ refreshView: vi.fn(async () => 'unchanged') }));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

const BEAD = 'mw-f758y.30.2';
// the row reads its bead's title, or the bead's id while no view is held
const BEAD_ROW = /GET \/api\/events streams message and view changes|mw-f758y\.30\.2/;
const RUNBOOK = 'The runbook is in hosts/desktop-move.md';
let sequence = 0;
let reads: Array<() => void> = [];

function post(text: string, thread: string | undefined, read: boolean): MessageRow {
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
    ts: 1_760_000_000 + sequence * 60,
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read,
    ...(thread === undefined ? {} : { thread }),
  };
}

/** Lets the Dexie reads and live-query updates that are ready run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

// A stand-in for App's routing: Talk on whatever the URL names, its header carries the pill.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : <p>Somewhere else</p>;
}

async function fresh(): Promise<void> {
  cleanup();
  stopLive();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  reads = [];
  sequence = 0;
  net.stream = undefined;
  forgetLastKnown();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

async function holds(): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  await db.messages.bulkPut([
    post('Factory word', undefined, true),
    post('Bead word one', `bead:${BEAD}`, false),
    post('Bead word two', `bead:${BEAD}`, false),
    post(RUNBOOK, 'topic:desktop move', false),
  ]);
}

async function listOpenAndLive(): Promise<void> {
  render(<Harness />);
  await act(async () => {
    startLive(new Uint8Array(32).fill(7));
    await vi.advanceTimersByTimeAsync(0);
  });
  await settle();
  expect(getLiveState().status).toBe('live');
  expect(within(screen.getByTestId('thread-list')).getAllByRole('listitem')).toHaveLength(3);
}

/** The phone's reads of what it holds wait for the sync that is writing: they answer only when let go. */
function slowReads(): void {
  for (const name of ['getAllOldestFirst', 'inThread', 'getAll'] as const) {
    const real = messagesRepo[name].bind(messagesRepo) as (key?: string) => Promise<MessageRow[]>;
    vi.spyOn(messagesRepo, name).mockImplementation(((key?: string) => new Promise<MessageRow[]>((resolve) => reads.push(() => void real(key).then(resolve)))) as never);
  }
}

async function dropsWhileReadsAreSlow(): Promise<void> {
  await act(async () => {
    net.stream?.error(new Error('The network dropped.'));
    await vi.advanceTimersByTimeAsync(0);
  });
  await settle();
  slowReads();
}

async function leavesAndComesBack(): Promise<void> {
  await act(async () => navigate('?v=me'));
  await settle();
  await act(async () => navigate('?v=talk'));
  await settle();
}

const pillReads = (_ctx: unknown, text: string) => {
  expect(getLiveState().status).toBe('reconnecting');
  expect(screen.getByTestId('live-badge')).toHaveTextContent(text);
};

afterAll(() => {
  stopLive();
  cleanup();
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/reconnect-keeps-lists.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-v1uyku.2 AC1: Channels lists every channel with its unread count while the pill says Reconnecting…', ({ Given, And, When, Then }) => {
    Given('the phone holds posts in Factory, in a bead\'s channel and in the channel {string}, some unread', holds);
    And('the Channels list is open and the connection is live', listOpenAndLive);
    When('the connection drops and the phone is slow to read what it holds', dropsWhileReadsAreSlow);
    And('he leaves Channels and comes back', leavesAndComesBack);
    Then('the pill reads {string}', pillReads);
    And('the Channels list shows Factory, the bead\'s channel with {int} unread and {string} with {int} unread', (_ctx, beadUnread: number, name: string, nameUnread: number) => {
      const list = within(screen.getByTestId('thread-list'));
      expect(list.getAllByRole('listitem')).toHaveLength(3);
      const rowOf = (title: string | RegExp) => list.getByText(title).closest('li') as HTMLElement;
      expect(list.getByText('Factory')).toBeInTheDocument();
      expect(within(rowOf(BEAD_ROW)).getByText(String(beadUnread))).toBeInTheDocument();
      expect(within(rowOf(name)).getByText(String(nameUnread))).toBeInTheDocument();
    });
  });

  Scenario('mw-v1uyku.2 AC2: a channel\'s messages stay shown while the pill says Reconnecting…', ({ Given, And, When, Then }) => {
    Given('the phone holds posts in Factory, in a bead\'s channel and in the channel {string}, some unread', holds);
    And('the Channels list is open and the connection is live', listOpenAndLive);
    When('the connection drops and the phone is slow to read what it holds', dropsWhileReadsAreSlow);
    And('the channel {string} is opened afresh', async () => {
      await act(async () => navigate('?v=me'));
      await settle();
      await act(async () => navigate({ view: 'talk', thread: 'topic:desktop move' }));
      await settle();
    });
    Then('the connection still reads reconnecting', () => {
      expect(getLiveState().status).toBe('reconnecting');
    });
    And('the channel shows {string} and not {string}', (_ctx, shown: string, absent: string) => {
      expect(screen.getByTestId('conversation')).toHaveTextContent(shown);
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    });
  });
});
