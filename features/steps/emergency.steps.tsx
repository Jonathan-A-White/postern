// features/steps/emergency.steps.tsx — runs features/emergency.feature (mw-jrx0s.13): the
// Shell around the Map and the Talk screen, the real message sync paging sealed `events`
// records (docs/protocol.md §22) including an emergency-lane one, and only the backend as a
// fetch double.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent, within, waitFor, configure } from '@testing-library/react';
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

configure({ asyncUtilTimeout: 5000 });

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

async function fresh(): Promise<void> {
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
});
