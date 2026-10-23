// features/steps/emergency.steps.tsx — runs features/emergency.feature (mw-jrx0s.13): the
// Shell around the Map and the Talk screen, the real message sync paging sealed `events`
// records (docs/protocol.md §22) including an emergency-lane one, and only the backend as a
// fetch double.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { Shell } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { subscribeEvents, syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage } from '../../src/services/messages';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { phonePaceCursors } from '../../tests/support/phone-cursor';

const GOV = PrivateKey.fromHex('44'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const PENDING_BEAD = 'mw-f758y.30.4';

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

let page: ApiRecord[] = [];
let recordSeq = 0;
let heard: number[] = [];
let unsubscribe: (() => void) | undefined;

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

const factoryEvent = (seq: number, lane: string, fields: { kind: string; bead: string; from: string; to: string; detail: string }) => ({ seq, ts: '2026-10-01T12:01:00Z', actor: 'mw@laptop', lane, ...fields });

function batchRecord(lane: string, events: Array<{ seq: number }>): ApiRecord {
  const batch = { from: events[0].seq, to: events[events.length - 1].seq, lane, events };
  return record(encryptMessage({ text: JSON.stringify(batch), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
}

const backend = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.includes('/messages')) {
    const records = page;
    page = [];
    return new Response(JSON.stringify({ records, next: recordSeq }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

function phone(): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return { matches: min ? 390 >= Number(min[1]) : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}

async function storeView(): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), etag: '"first"', source: 'live', fetchedAt: now });
}

function openMap(): void {
  window.history.replaceState(null, '', '/?v=map');
  render(
    <Shell route={{ view: 'map' }}>
      <MapScreen />
    </Shell>,
  );
}

async function sync(): Promise<void> {
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

/** The pending batch (seqs 5 and 6, the cursor at 4) and then the emergency (seq 7) arrive in one page. */
async function pageEmergency(detail: string, bead: string): Promise<void> {
  const pending = batchRecord('normal', [
    factoryEvent(5, 'normal', { kind: 'bead_changed', bead: PENDING_BEAD, from: 'open', to: 'claimed', detail: 'status' }),
    factoryEvent(6, 'normal', { kind: 'bead_changed', bead: PENDING_BEAD, from: 'claimed', to: 'running', detail: 'status' }),
  ]);
  const emergency = batchRecord('emergency', [factoryEvent(7, 'emergency', { kind: 'alarm', bead, from: '', to: '', detail })]);
  page = [pending, emergency];
  await sync();
}

/** How many events the long history holds: his phone keeps every event since mw-jrx0s.7, thousands a day. With
 * PHONE_STEP_MS a read of all of them takes about 30 s, as a read of his phone's tens of thousands does there. */
const HISTORY = 7_500;

/** The phone's long history: seqs 1 to HISTORY, every one a normal-lane bead change, the cursor at the last. */
async function holdHistory(): Promise<void> {
  const history = Array.from({ length: HISTORY }, (_, i) => factoryEvent(i + 1, 'normal', { kind: 'bead_changed', bead: PENDING_BEAD, from: 'open', to: 'claimed', detail: 'status' }));
  await db.events.bulkAdd(history);
  await eventsRepo.setCursor(HISTORY);
}

/** His phone's pace: a cursor step costs this much there, against microseconds in fake-indexeddb. */
const PHONE_STEP_MS = 4;

/** Puts fake-indexeddb's own pace back when a scenario that read at the phone's has ended. */
let fakePace: (() => void) | undefined;

/** A seat_limited event (millwright's domain/events/seatlimited.go) in the emergency lane, its until time `ms` from now. */
async function pageSeatLimited(_c: unknown, seat: string, ms: number): Promise<void> {
  const until = new Date(Math.floor((Date.now() + ms) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const detail = `${seat} in ${seat} until ${until}: You've hit your limit`;
  page = [batchRecord('emergency', [{ ...factoryEvent(7, 'emergency', { kind: 'seat_limited', bead: '', from: '', to: '', detail }), actor: seat, ts: new Date().toISOString() }])];
  await sync();
}

async function fresh(): Promise<void> {
  fakePace?.();
  fakePace = undefined;
  cleanup();
  lock();
  unsubscribe?.();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', backend);
  phone();
  page = [];
  recordSeq = 0;
  heard = [];
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.beadDetails.clear()]);
  await eventsRepo.setCursor(4);
  await storeView();
  setKey(KEY);
  unsubscribe = subscribeEvents({}, (event) => heard.push(event.seq));
}

afterAll(() => {
  fakePace?.();
  cleanup();
  lock();
  unsubscribe?.();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const banner = () => screen.findByRole('alert', { name: 'Emergency' });
const tapBanner = async () => fireEvent.click(within(await banner()).getByRole('button'));
const bannerGone = async () => {
  await waitFor(() => expect(screen.queryByRole('alert', { name: 'Emergency' })).not.toBeInTheDocument());
};

/** A normal-lane event that ends emergency `clears` (docs/events.md), the next seq after the emergencies. */
async function pageClearing(_c: unknown, detail: string, clears: number): Promise<void> {
  const seq = (await db.events.orderBy('seq').last())?.seq ?? 0;
  page = [batchRecord('normal', [{ ...factoryEvent(seq + 1, 'normal', { kind: 'job', bead: '', from: 'running', to: 'done', detail }), clears }])];
  await sync();
}

const noBanner = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await bannerGone();
};

const reopenMap = async () => {
  cleanup();
  openMap();
  await screen.findByRole('navigation', { name: 'Places' });
};

const feature = await loadFeature('features/emergency.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const mapOpen = async () => {
    openMap();
    await screen.findByRole('navigation', { name: 'Places' });
  };
  const emergencyOnTheBead = async (_c: unknown, detail: string, bead: string) => pageEmergency(detail, bead);

  Scenario('mw-jrx0s.13: an emergency arriving while batches are pending shows the banner on the Map at once, and a tap clears it and opens the bead', ({ Given, When, Then, And }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages the Mayor\'s emergency {string} about {string} after the pending batch', emergencyOnTheBead);
    Then('the banner at the top of the Map says {string}', async (_c, detail: string) => {
      expect(await banner()).toHaveTextContent(detail);
    });
    And('the pending batch was applied after the emergency', async () => {
      await waitFor(() => expect(heard).toEqual([7, 6]));
    });
    When('he taps the banner', tapBanner);
    Then('the banner is gone', bannerGone);
    And('the bead {string} is open', async (_c, bead: string) => {
      await waitFor(() => expect(window.location.search).toBe(`?v=bead&id=${bead}`));
    });
  });

  Scenario('mw-jrx0s.13: an emergency about no bead shows on the Talk screen too, and a tap opens the Talk line', ({ Given, When, Then, And }) => {
    Given('the Talk screen is open on a phone', async () => {
      window.history.replaceState(null, '', '/?v=talk');
      render(
        <Shell route={{ view: 'talk' }}>
          <TalkScreen thread="general" />
        </Shell>,
      );
      await screen.findByRole('navigation', { name: 'Places' });
    });
    When('the sync pages the Mayor\'s emergency {string} about no bead', async (_c, detail: string) => pageEmergency(detail, ''));
    Then('the banner at the top of the Talk screen says {string}', async (_c, detail: string) => {
      expect(await banner()).toHaveTextContent(detail);
    });
    When('he taps the banner', tapBanner);
    Then('the banner is gone', bannerGone);
    And('the Talk line is open', async () => {
      await waitFor(() => expect(window.location.search).toBe('?v=line'));
    });
  });

  Scenario('mw-jrx0s.13: a cleared emergency stays cleared after the app opens again', ({ Given, When, Then, And }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages the Mayor\'s emergency {string} about {string} after the pending batch', emergencyOnTheBead);
    And('he taps the banner', tapBanner);
    And('the app is opened again on the Map', async () => {
      await bannerGone();
      cleanup();
      openMap();
      await screen.findByRole('navigation', { name: 'Places' });
    });
    Then('the banner is gone', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await bannerGone();
    });
  });

  Scenario('mw-jrx0s.13: an emergency that was paged before is not applied twice when the ordinary batches follow', ({ Given, When, Then }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages the Mayor\'s emergency {string} about {string} after the pending batch', emergencyOnTheBead);
    Then('every event was kept once and the cursor is at the last', async () => {
      expect((await db.events.orderBy('seq').toArray()).map((e) => e.seq)).toEqual([5, 6, 7]);
      expect(await eventsRepo.cursor()).toBe(7);
      expect(heard).toEqual([7, 6]);
    });
  });

  Scenario('mw-gq6.247: an event that clears the shown emergency takes the banner away by itself, and it stays away after the app opens again', ({ Given, When, Then }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages the Mayor\'s emergency {string} about {string} after the pending batch', emergencyOnTheBead);
    Then('the banner at the top of the Map says {string}', async (_c, detail: string) => {
      expect(await banner()).toHaveTextContent(detail);
    });
    When('the sync pages the factory\'s normal event {string} that clears emergency {int}', pageClearing);
    Then('the banner is gone', bannerGone);
    When('the app is opened again on the Map', async () => {
      cleanup();
      openMap();
      await screen.findByRole('navigation', { name: 'Places' });
    });
    Then('no banner shows', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await bannerGone();
    });
  });

  Scenario('mw-gq6.247: an event that clears an older emergency leaves a newer one on the banner', ({ Given, When, Then, And }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages the Mayor\'s emergency {string} about {string} after the pending batch', emergencyOnTheBead);
    And('the sync pages the Mayor\'s later emergency {string} about {string}', async (_c, detail: string, bead: string) => {
      page = [batchRecord('emergency', [factoryEvent(8, 'emergency', { kind: 'alarm', bead, from: '', to: '', detail })])];
      await sync();
    });
    And('the sync pages the factory\'s normal event {string} that clears emergency {int}', pageClearing);
    Then('the banner at the top of the Map says {string}', async (_c, detail: string) => {
      await waitFor(() => expect(screen.getByRole('alert', { name: 'Emergency' })).toHaveTextContent(detail));
    });
  });

  Scenario('mw-gq6.712: on a phone that holds a long history of events, his tap clears the banner and it stays gone after the app opens again', ({ Given, When, Then }) => {
    Given('the Map is open on a phone that holds a long history of the factory\'s events, read at his phone\'s pace', async () => {
      await holdHistory();
      fakePace = phonePaceCursors(PHONE_STEP_MS);
      await mapOpen();
    });
    When('the sync pages the Mayor\'s emergency {string} about no bead after that history', async (_c, detail: string) => {
      page = [batchRecord('emergency', [factoryEvent(HISTORY + 1, 'emergency', { kind: 'message', bead: '', from: '', to: '', detail })])];
      await sync();
    });
    Then('the banner at the top of the Map says {string}', async (_c, detail: string) => {
      expect(await banner()).toHaveTextContent(detail);
    });
    When('he taps the banner', tapBanner);
    Then('the banner is gone', bannerGone);
    When('the app is opened again on the Map', reopenMap);
    Then('no banner shows', noBanner);
  });

  Scenario('mw-gq6.712: a seat_limited emergency leaves the banner by itself when its until time passes', ({ Given, When, Then, And }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages a seat_limited emergency for {string} until {int} seconds from now', async (_c, seat: string, seconds: number) => pageSeatLimited(_c, seat, seconds * 1000));
    Then('the banner at the top of the Map says {string}', async (_c, detail: string) => {
      expect(await banner()).toHaveTextContent(detail);
    });
    And('the banner offers Dismiss', async () => {
      expect(within(await banner()).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
    Then('the banner is gone', bannerGone);
    When('the app is opened again on the Map', reopenMap);
    Then('no banner shows', noBanner);
  });

  Scenario('mw-gq6.712: a seat_limited emergency whose until time has passed shows no banner', ({ Given, When, Then }) => {
    Given('the Map is open on a phone, with a batch of events pending in the same sync', mapOpen);
    When('the sync pages a seat_limited emergency for {string} until {int} seconds ago', async (_c, seat: string, seconds: number) => pageSeatLimited(_c, seat, -seconds * 1000));
    Then('no banner shows', noBanner);
  });
});
