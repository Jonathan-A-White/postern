// features/steps/last-route.steps.tsx — runs features/last-route.feature (mw-f758y.31). "Closed
// and opened again" is src/main.tsx's start-up (restoreLastRoute, restoreScrolls) run on a bare
// address; the screens it lands on are rendered through the app's own router.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, act, configure, getConfig } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { forgetRestoredBead, restoreLastRoute, saveLastRoute } from '../../src/nav/lastRoute';
import { forgetScrolls, restoreScrolls, useScrollMemory } from '../../src/nav/scrollMemory';
import { formatRoute, parseRoute } from '../../src/nav/route';
import { SLOW_HOST_MS, waitForRoute } from '../../tests/support/wait-for-route';
import { setKey, lock } from '../../src/services/keySession';
import { fetchBeadDetail } from '../../src/services/beads';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'missing' as const })),
}));

const feature = await loadFeature('features/last-route.feature');

const beadAt = (id: string) => formatRoute({ view: 'bead', id });
const threadAt = (thread: string) => formatRoute({ view: 'talk', thread });

/** What the app does on a move: the address changes and App's effect keeps it. */
function moveTo(search: string): void {
  window.history.pushState({ app: true }, '', search);
  saveLastRoute(window.location.search);
}

/**
 * Shows a bead on a host so loaded that the unlocked key reaches the screen 1.2 s late (past waitFor's default 1 s), so
 * the screen's fetch starts that much later: a step that waits on the fetch with the default timeout fails on it (mw-ezzapm).
 */
const SLOW_HOST_KEY_MS = 1200;
function renderBeadOnSlowHost(id: string): void {
  lock();
  render(<BeadScreen id={id} />);
  setTimeout(() => act(() => setKey(new Uint8Array(32))), SLOW_HOST_KEY_MS);
}

/** The phone closes the app and opens it at the home-screen icon's address. */
function reopenBare(): void {
  window.history.replaceState(null, '', '/');
  forgetScrolls();
  forgetRestoredBead();
  restoreLastRoute();
  restoreScrolls();
}

/** jsdom does no layout: a box whose scrollTop holds what it is given and says so with a scroll event. */
function fakeScroll(el: HTMLElement | null): void {
  if (!el) return;
  let value = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (v: number) => {
      value = v;
      el.dispatchEvent(new Event('scroll'));
    },
  });
}

// eslint-disable-next-line react-refresh/only-export-components
function Box() {
  const remember = useScrollMemory('page');
  return (
    <div
      data-testid="box"
      ref={(el) => {
        fakeScroll(el);
        remember(el);
      }}
    >
      <div>content</div>
    </div>
  );
}

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  // tests/setup.ts raises waitFor's default to 5 s; this file puts back Testing Library's own 1 s, so a step that
  // waits without an explicit timeout fails on a slow host here as it can on a loaded one (mw-ezzapm).
  const suiteTimeout = getConfig().asyncUtilTimeout;
  configure({ asyncUtilTimeout: 1000 });
  afterAll(() => configure({ asyncUtilTimeout: suiteTimeout }));
  BeforeEachScenario(() => {
    localStorage.clear();
    forgetScrolls();
    forgetRestoredBead();
    window.history.replaceState(null, '', '/');
    vi.mocked(fetchBeadDetail).mockClear();
  });
  AfterEachScenario(() => {
    cleanup();
    lock();
  });
  afterAll(() => cleanup());

  const atBead = (id: string) => expect(parseRoute(window.location.search)).toEqual({ view: 'bead', id });

  Scenario('mw-f758y.31 AC-1: a bare open goes back to the bead he was on', ({ Given, When, Then }) => {
    Given('he has been on the bead "mw-x.1"', () => moveTo(beadAt('mw-x.1')));
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the app opens at the bead "mw-x.1"', () => atBead('mw-x.1'));
  });

  Scenario('mw-f758y.31 AC-1: a channel thread is kept too', ({ Given, When, Then }) => {
    Given('he has been in the thread "topic:library" of Channels', () => moveTo(threadAt('topic:library')));
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the app opens at the thread "topic:library"', () => expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: 'topic:library' }));
  });

  Scenario('mw-f758y.31 AC-1: the last move is the one kept', ({ Given, And, When, Then }) => {
    Given('he has been on the bead "mw-x.1"', () => moveTo(beadAt('mw-x.1')));
    And('he then moved to the Me screen', () => moveTo(formatRoute({ view: 'me' })));
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the app opens at the Me screen', () => expect(parseRoute(window.location.search)).toEqual({ view: 'me' }));
  });

  Scenario('mw-f758y.31 AC-1: a push tap wins over where he left', ({ Given, When, Then }) => {
    Given('he has been on the bead "mw-x.1"', () => moveTo(beadAt('mw-x.1')));
    When('the app is opened by a push tap at the thread "topic:library"', () => {
      window.history.replaceState(null, '', threadAt('topic:library'));
      forgetScrolls();
      restoreLastRoute();
      restoreScrolls();
    });
    Then('the app opens at the thread "topic:library"', () => expect(parseRoute(window.location.search)).toEqual({ view: 'talk', thread: 'topic:library' }));
  });

  Scenario("mw-f758y.31 AC-1: a push's landing screen is not somewhere to return to", ({ Given, And, When, Then }) => {
    Given('he has been on the bead "mw-x.1"', () => moveTo(beadAt('mw-x.1')));
    And('a push tap then showed him an alarm', () => moveTo(formatRoute({ view: 'alarm', title: 'desktop unreachable' })));
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the app opens at the bead "mw-x.1"', () => atBead('mw-x.1'));
  });

  Scenario('mw-f758y.31 AC-1: a first open, with nothing kept, opens as it always did', ({ Given, When, Then }) => {
    Given('nothing has been kept', () => expect(localStorage.length).toBe(0));
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the address is still bare', () => expect(window.location.search).toBe(''));
  });

  Scenario('mw-f758y.31 AC-1: a bead that no longer exists falls back to the Map', ({ Given, And, When, Then }) => {
    Given('he has been on the bead "mw-gone.1"', () => moveTo(beadAt('mw-gone.1')));
    And('the app is opened again at its bare address', async () => {
      reopenBare();
      await db.view.clear();
      await db.beadDetails.clear();
      renderBeadOnSlowHost('mw-gone.1');
    });
    When('the backend says there is no such bead', async () => {
      await waitFor(() => expect(fetchBeadDetail).toHaveBeenCalled(), { timeout: SLOW_HOST_MS });
    });
    Then('the app moves to the Map', async () => {
      await waitForRoute({ view: 'map' });
    });
  });

  Scenario('mw-f758y.31 AC-1: a bead typed into a link that does not exist is still told so', ({ Given, When, Then }) => {
    Given('he follows a link to the bead "mw-gone.2"', async () => {
      moveTo(beadAt('mw-gone.2'));
      await db.view.clear();
      await db.beadDetails.clear();
      renderBeadOnSlowHost('mw-gone.2');
    });
    When('the backend says there is no such bead', async () => {
      await waitFor(() => expect(fetchBeadDetail).toHaveBeenCalled(), { timeout: SLOW_HOST_MS });
    });
    Then('the screen says "No such bead"', async () => {
      expect(await screen.findByText('No such bead', undefined, { timeout: SLOW_HOST_MS })).toBeInTheDocument();
      expect(parseRoute(window.location.search)).toEqual({ view: 'bead', id: 'mw-gone.2' });
    });
  });

  Scenario('mw-f758y.31 AC-1: the scroll position of the screen comes back too', ({ Given, When, Then }) => {
    Given('he has scrolled the bead "mw-x.1" to 300', () => {
      moveTo(beadAt('mw-x.1'));
      render(<Box />);
      act(() => {
        screen.getByTestId('box').scrollTop = 300;
      });
      // Leaving the page writes what is kept (src/nav/scrollMemory.ts).
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      cleanup();
    });
    When('the app is closed and opened again at its bare address', reopenBare);
    Then('the bead "mw-x.1" is scrolled to 300', async () => {
      atBead('mw-x.1');
      render(<Box />);
      await waitFor(() => expect(screen.getByTestId('box').scrollTop).toBe(300), { timeout: SLOW_HOST_MS });
    });
  });
});
