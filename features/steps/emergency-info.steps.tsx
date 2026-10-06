// features/steps/emergency-info.steps.tsx — runs features/emergency-info.feature (mw-gq6.277):
// the whole app (<App />) opened at the emergency notification's own url, and the Shell around the Map
// with the real sync paging a sealed emergency record. Only the backend is a fetch double.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PrivateKey, Utils } from '@bsv/sdk';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { App } from '../../src/App';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { Shell } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { eventsRepo, vaultRepo, viewRepo } from '../../src/data/repositories';
import { notificationSpecForEmergency } from '../../src/push/classOptions';
import { lock, setKey } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { subscribeEvents, syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage } from '../../src/services/messages';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const GOV = PrivateKey.fromHex('45'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const MINUTE = 60_000;

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

let page: ApiRecord[] = [];
let unsubscribe: (() => void) | undefined;

const backend = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.includes('/messages')) {
    const records = page;
    page = [];
    return new Response(JSON.stringify({ records, next: records.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/me')) return new Response(JSON.stringify({ pubkey: GOV_PUB, mayor: MAYOR_PUB, network: 'testnet', features: ['direct', 'events', 'view'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('not found', { status: 404 });
};

/** A job event of the emergency lane that began `agoMs` ago. */
const emergencyEvent = (actor: string, to: string, detail: string, agoMs: number) => ({
  seq: 7,
  ts: new Date(Date.now() - agoMs).toISOString(),
  kind: 'job',
  bead: '',
  actor,
  from: 'running',
  to,
  detail,
  lane: 'emergency',
});

async function fresh(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  unsubscribe?.();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', backend);
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return { matches: min ? 390 >= Number(min[1]) : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
  page = [];
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.beadDetails.clear(), db.vault.clear()]);
  await eventsRepo.setCursor(4);
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), etag: '"first"', source: 'live', fetchedAt: now });
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: GOV_PUB });
  setKey(KEY);
  unsubscribe = subscribeEvents({}, () => undefined);
}

afterAll(() => {
  cleanup();
  stopLive();
  lock();
  unsubscribe?.();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

async function pageEmergency(event: ReturnType<typeof emergencyEvent>): Promise<void> {
  const batch = { from: event.seq, to: event.seq, lane: 'emergency', events: [event] };
  page = [{ seq: 1, txid: '1'.padStart(64, '0'), vout: 0, payload: encryptMessage({ text: JSON.stringify(batch), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }) }];
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

const banner = () => screen.findByRole('alert', { name: 'Emergency' });
const bannerGone = async () => {
  await waitFor(() => expect(screen.queryByRole('alert', { name: 'Emergency' })).not.toBeInTheDocument());
};

const feature = await loadFeature('features/emergency-info.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const mapOpen = async () => {
    window.history.replaceState(null, '', '/?v=map');
    render(
      <Shell route={{ view: 'map' }}>
        <MapScreen />
      </Shell>,
    );
    await screen.findByRole('navigation', { name: 'Places' });
  };
  const bannerSays = async (_c: unknown, detail: string) => {
    expect(await banner()).toHaveTextContent(detail);
  };

  Scenario('mw-gq6.277: tapping the emergency notification opens the emergency\'s words, who sent it and when', ({ Given, When, Then, And }) => {
    Given('the Mayor\'s information emergency {string} is held on the phone', async (_c, detail: string) => {
      await eventsRepo.addNew([emergencyEvent('mayor@laptop', 'done', detail, MINUTE)]);
    });
    When('he taps the emergency notification', async () => {
      const url = notificationSpecForEmergency('direct:abc').options.data?.url as string;
      window.history.pushState({}, '', url);
      render(<App />);
    });
    Then('the Emergency screen shows {string}', async (_c, detail: string) => {
      const article = await screen.findByRole('article', { name: 'Emergency' });
      expect(article).toHaveTextContent(detail);
    });
    And('the Emergency screen names the actor {string} and the time', async (_c, actor: string) => {
      const article = await screen.findByRole('article', { name: 'Emergency' });
      expect(article).toHaveTextContent(actor);
      expect(article.querySelector('time')).not.toBeNull();
    });
  });

  Scenario('mw-gq6.277: an information emergency whose job is done shows in the banner, and Dismiss takes it away without leaving the screen', ({ Given, When, Then, And }) => {
    Given('the Map is open on a phone', mapOpen);
    When('the sync pages the Mayor\'s information emergency {string} from a minute ago', async (_c, detail: string) => pageEmergency(emergencyEvent('mayor@laptop', 'done', detail, MINUTE)));
    Then('the banner at the top of the Map says {string}', bannerSays);
    When('he dismisses the banner', async () => fireEvent.click(within(await banner()).getByRole('button', { name: 'Dismiss' })));
    Then('the banner is gone', bannerGone);
    And('the Map is still open', () => {
      expect(window.location.search).toBe('?v=map');
    });
  });

  Scenario('mw-gq6.277: an information emergency from more than ten minutes ago shows no banner', ({ Given, When, Then }) => {
    Given('the Map is open on a phone', mapOpen);
    When('the sync pages the Mayor\'s information emergency {string} from eleven minutes ago', async (_c, detail: string) => pageEmergency(emergencyEvent('mayor@laptop', 'done', detail, 11 * MINUTE)));
    Then('no banner shows', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await bannerGone();
    });
  });

  Scenario('mw-gq6.277: a failed emergency from more than ten minutes ago still shows until it is cleared', ({ Given, When, Then }) => {
    Given('the Map is open on a phone', mapOpen);
    When('the sync pages the doctor\'s failed emergency {string} from eleven minutes ago', async (_c, detail: string) => pageEmergency(emergencyEvent('doctor@desktop', 'failed', detail, 11 * MINUTE)));
    Then('the banner at the top of the Map says {string}', bannerSays);
  });
});
