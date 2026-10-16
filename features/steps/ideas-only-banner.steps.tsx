// features/steps/ideas-only-banner.steps.tsx — runs features/ideas-only-banner.feature (mw-8ifimx.4):
// the real Shell with the channel, a bead page, the Talk line and Settings inside it, over a Dexie that
// keeps one key's Ideas only answer and a fake backend for GET /api/ideas-only/{key}; Date is frozen
// (timers stay real).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { Shell } from '../../src/cockpit/Shell';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, settingsRepo, viewRepo } from '../../src/data/repositories';
import type { IdeasOnlyKept } from '../../src/model/ideasOnly';
import { useRoute } from '../../src/router';
import { lock, setKey } from '../../src/services/keySession';
import { onIdeasOnlyEvent } from '../../src/services/ideasOnly';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { fixtureDetail, fixtureView } from '../../tests/support/cockpit-fixture';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const HIM = publicKeyHexFromMasterKey(HIM_KEY);
const BEAD = 'mw-f758y.31.2';

/** What the fake backend answers for his key: on until this Unix second, or off (0). */
let backendUntil = 0;

const secs = (iso: string): number => new Date(iso).getTime() / 1000;

// A stand-in for App's routing.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  let place;
  if (route.view === 'line') place = <TalkLineScreen />;
  else if (route.view === 'talk') place = <TalkScreen thread={route.thread} root={route.root} />;
  else if (route.view === 'bead') place = <BeadScreen id={route.id} />;
  else if (route.view === 'me') place = <MeScreen />;
  else place = <div>Needs place</div>;
  return <Shell route={route}>{place}</Shell>;
}

function answer(): Response {
  const on = backendUntil * 1000 > Date.now();
  const body = { setting: { until: backendUntil, reaches: {} }, state: { on, until: on ? backendUntil : 0, by: on ? 'until' : '' } };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function start(clock: string, until: string | null): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  thawClock();
  freezeClock(clock);
  backendUntil = until ? secs(until) : 0;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.outbox.clear(), db.beadDetails.clear()]);
  const kept: IdeasOnlyKept = {
    key: HIM,
    setting: { until: backendUntil, reaches: {} },
    state: until ? { on: true, until: backendUntil, by: 'until' } : { on: false, until: 0, by: '' },
    at: 0,
  };
  await settingsRepo.setIdeasOnly(kept);
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView()), written_at: fixtureView().written_at, source: 'live', fetchedAt: Date.now() });
  const detail = fixtureDetail(BEAD);
  if (detail) await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
  setKey(HIM_KEY);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith(`/ideas-only/${HIM}`)) return answer();
      return new Response('not found', { status: 404 });
    }),
  );
}

const open = (search: string) => {
  window.history.replaceState(null, '', search);
  cleanup();
  render(<Harness />);
};

const bannerSays = async (_c: unknown, first: string, second: string) => {
  await screen.findByTestId('ideas-only-banner');
  await waitFor(() => expect(screen.getByTestId('ideas-only-banner')).toHaveTextContent(first));
  expect(screen.getByTestId('ideas-only-banner')).toHaveTextContent(second);
};

const noBanner = async () => {
  // the section that asks for the answer has had its moment
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  await waitFor(() => expect(screen.queryByTestId('ideas-only-banner')).toBeNull());
};

afterAll(() => {
  cleanup();
  lock();
  thawClock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/ideas-only-banner.feature');

describeFeature(feature, ({ Scenario }) => {
  const onUntil21 = () => start('2026-10-01T14:00:00', '2026-10-01T21:00:00');
  const generalChannel = async () => open('/?v=talk&t=general');

  Scenario('mw-8ifimx.4 AC-1: the banner shows on the channel, a bead page and the Talk line', ({ Given, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", onUntil21);
    When('the General channel is open', generalChannel);
    Then('the banner says {string} and {string}', bannerSays);
    When('a bead page is open', async () => open(`/?v=bead&id=${BEAD}`));
    Then('the bead page wears the banner {string} and {string}', bannerSays);
    When('the Talk line is open', async () => open('/?v=line'));
    Then('the Talk line wears the banner {string} and {string}', bannerSays);
  });

  Scenario('mw-8ifimx.4 AC-1: with the mode off there is no banner', ({ Given, When, Then }) => {
    Given("Ideas only is off and the phone's clock says 14:00", () => start('2026-10-01T14:00:00', null));
    When('the General channel is open', generalChannel);
    Then('there is no banner', noBanner);
  });

  Scenario('mw-8ifimx.4 AC-1: an end on another day names the day', ({ Given, When, Then }) => {
    Given("Ideas only is on until tomorrow 07:00 and the phone's clock says 14:00", () => start('2026-10-01T14:00:00', '2026-10-02T07:00:00'));
    When('the General channel is open', generalChannel);
    Then('the banner says {string} and {string}', bannerSays);
  });

  Scenario('mw-8ifimx.4 AC-1: a tap on the banner opens Settings', ({ Given, When, And, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", onUntil21);
    When('the General channel is open', generalChannel);
    And('he taps the banner', async () => {
      fireEvent.click(await within(await screen.findByTestId('ideas-only-banner')).findByRole('button'));
    });
    Then('Settings is open with its Ideas only section', async () => {
      await screen.findByRole('region', { name: 'Ideas only' });
      expect(window.location.search).toBe('?v=me');
    });
  });

  Scenario('mw-8ifimx.4 AC-1: the stream saying it is off removes the banner', ({ Given, When, And, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", onUntil21);
    When('the General channel is open', generalChannel);
    And('the stream says Ideas only is off', async () => {
      await screen.findByTestId('ideas-only-banner');
      backendUntil = 0;
      await act(async () => onIdeasOnlyEvent(HIM_KEY, JSON.stringify({ key: HIM, on: false, until: 0 })));
    });
    Then('there is no banner', noBanner);
  });

  Scenario("mw-8ifimx.4 AC-1: with no stream the phone's clock passing the end removes the banner", ({ Given, When, And, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", onUntil21);
    When('the General channel is open', generalChannel);
    And("the phone's clock reaches 21:00", async () => {
      await screen.findByTestId('ideas-only-banner');
      // the backend cannot be reached: the answer it gave stays as kept
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
      vi.setSystemTime(new Date('2026-10-01T21:00:01'));
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    });
    Then('there is no banner', noBanner);
  });
});
