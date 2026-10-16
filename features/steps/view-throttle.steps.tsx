// features/steps/view-throttle.steps.tsx — runs features/view-throttle.feature (mw-7dige5.4): the real
// live.ts loop, view.ts and events.ts reading a stream this file writes to; only the network (apiFetch,
// the message sync, /me) is a double, and the clock is fake; the view's inflate, the one real-time piece, is held until
// the clock stops (tests/support/held-inflate.ts).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrivateKey, Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { db } from '../../src/data/db';
import { sealDocument } from '../../src/services/documents';
import { refreshNow, startLive, stopLive } from '../../src/services/live';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { holdInflates, settle } from '../../tests/support/held-inflate';

const net = vi.hoisted(() => ({
  stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  /** every GET /api/view: the If-None-Match it carried */
  views: [] as (string | null)[],
  /** the sealed view the backend serves, and the ETag it serves it under */
  sealed: '',
  etag: '"e1"',
  mayor: '',
}));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.split('?')[0] === '/view') {
      const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
      net.views.push(ifNoneMatch);
      if (ifNoneMatch === net.etag) return new Response(null, { status: 304 });
      return new Response(net.sealed, { status: 200, headers: { ETag: net.etag } });
    }
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          net.stream = controller;
        },
      }),
    };
  }),
}));
vi.mock('../../src/services/inbox', () => ({ syncMessages: vi.fn(async () => ({ events: [] })) }));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: net.mayor, network: 'testnet', features: ['events', 'view'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: net.mayor, offered: undefined })),
}));

holdInflates(); // the view's inflate takes real time: it comes back only when advance() has stopped the clock (mw-ev7oyy.18)

const GOV = PrivateKey.fromHex('45'.repeat(32));
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const encoder = new TextEncoder();

/** Moves the fake clock once all the work begun has settled, and lets what it set going settle before it returns. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await settle();
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  });
}

async function say(block: string): Promise<void> {
  net.stream?.enqueue(encoder.encode(`${block}\n\n`));
  await advance(0);
}

const hello = (etag: string) => say(`event: hello\ndata: ${JSON.stringify({ head: 1, view: etag })}`);

async function live(): Promise<void> {
  cleanup();
  stopLive();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  net.stream = undefined;
  net.views = [];
  net.etag = '"e1"';
  net.mayor = MAYOR.toPublicKey().toString();
  net.sealed = await sealDocument(JSON.stringify(fixtureView()), MAYOR.toHex(), GOV.toPublicKey().toString());
  await Promise.all([db.view.clear(), db.events.clear(), db.settings.clear(), db.messages.clear()]);
  await act(async () => {
    startLive(KEY);
  });
  await advance(0);
  await hello('"e1"'); // the stream opens naming the view the start just fetched
  expect(net.views).toEqual([null]);
}

function viewsFetched(count: number): void {
  expect(net.views).toHaveLength(count);
}

function secondAskedWithTheHeldEtag(): void {
  expect(net.views[1]).toBe('"e1"');
}

afterAll(() => {
  cleanup();
  stopLive();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/view-throttle.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-7dige5.4: a hello naming the view the phone already holds fetches nothing', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the stream says hello naming that same view', () => hello('"e1"'));
    Then('two minutes on, the view has been fetched once in all', async () => {
      await advance(120_000);
      viewsFetched(1);
    });
  });

  Scenario('mw-7dige5.4: a hello naming another view fetches it, asking with the ETag held, when the minute is out', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('five seconds on the stream says hello naming another view', async () => {
      await advance(5_000);
      net.etag = '"e2"';
      await hello('"e2"');
    });
    Then('at once the view has been fetched once in all', () => viewsFetched(1));
    And('a minute on, the view has been fetched twice in all, the second time asking with the ETag held', async () => {
      await advance(60_000);
      viewsFetched(2);
      secondAskedWithTheHeldEtag();
    });
  });

  Scenario('mw-7dige5.4: screens asking for the view inside the minute make one fetch when it is out', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('five screens ask for the view over the next thirty seconds', async () => {
      net.etag = '"e2"';
      for (let i = 0; i < 5; i += 1) {
        await advance(6_000);
        await act(async () => {
          await refreshNow({ view: 'focus' }); // the Map sent to a bead its copy does not hold
        });
      }
    });
    Then('at once the view has been fetched once in all', () => viewsFetched(1));
    And('a minute on, the view has been fetched twice in all, the second time asking with the ETag held', async () => {
      await advance(60_000);
      viewsFetched(2);
      secondAskedWithTheHeldEtag();
    });
  });

  Scenario('mw-7dige5.4: a tap on the Needs you Refresh button fetches at once, inside the minute, asking with the ETag held', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('five seconds on Refresh is tapped on the Needs you screen', async () => {
      net.etag = '"e2"';
      await advance(5_000);
      render(<NeedsScreen />);
      await advance(0);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      });
      await advance(0);
    });
    Then('the view has been fetched twice in all, the second time asking with the ETag held', () => {
      viewsFetched(2);
      secondAskedWithTheHeldEtag();
    });
    And('two minutes on, the view has been fetched twice in all', async () => {
      await advance(120_000);
      viewsFetched(2);
    });
  });
});
