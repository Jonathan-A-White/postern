// features/steps/history-reopen.steps.tsx — runs features/history-reopen.feature (mw-f758y.41). A move is
// the router's navigate plus what App's effect does with the new address (saveLastRoute); "closed and
// opened again" is src/main.tsx's start-up (restoreLastRoute, restoreScrolls) on a fresh history entry.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, act, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { forgetRestoredBead, forgetTrail, restoreLastRoute, saveLastRoute } from '../../src/nav/lastRoute';
import { forgetScrolls, restoreScrolls, useScrollMemory } from '../../src/nav/scrollMemory';
import { formatRoute, parseRoute } from '../../src/nav/route';
import { navigate, useScreenSearch } from '../../src/router';
import { setKey, lock } from '../../src/services/keySession';
import { fetchBeadDetail } from '../../src/services/beads';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'missing' as const })),
}));

const feature = await loadFeature('features/history-reopen.feature');

const beadAt = (id: string) => formatRoute({ view: 'bead', id });
const threadAt = (thread: string) => formatRoute({ view: 'talk', thread });

function go(search: string): void {
  navigate(search);
  saveLastRoute(window.location.search);
}

/** The phone closes the app and opens it at `address` ('/' is the home-screen icon). */
function reopen(address = '/'): void {
  window.history.replaceState(null, '', address);
  forgetScrolls();
  forgetRestoredBead();
  restoreLastRoute();
  restoreScrolls();
}

/** Back, as the phone's button does it: the address changes on popstate, and App's effect keeps it. */
async function back(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
  saveLastRoute(window.location.search);
}

const route = () => parseRoute(window.location.search);

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
  const remember = useScrollMemory('channel');
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

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const search = useScreenSearch();
  return <Box key={search} />;
}

const box = () => screen.getByTestId('box') as HTMLElement;

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(() => {
    localStorage.clear();
    forgetScrolls();
    forgetTrail();
    window.history.replaceState(null, '', '/');
    vi.mocked(fetchBeadDetail).mockClear();
  });
  AfterEachScenario(() => {
    cleanup();
    lock();
  });
  afterAll(() => cleanup());

  Scenario('mw-f758y.41 AC-1: Back walks the last 20 screens after a reopen, newest first, then the Map', ({ Given, When, Then, And }) => {
    Given('he has visited 25 beads one after another', () => {
      for (let n = 1; n <= 25; n++) go(beadAt(`mw-${n}`));
    });
    When('the app is closed and opened again at its bare address', () => reopen());
    Then('the app opens at the newest bead', () => expect(route()).toEqual({ view: 'bead', id: 'mw-25' }));
    And('pressing Back 19 times reaches the 20th newest bead', async () => {
      for (let n = 24; n >= 6; n--) {
        await back();
        expect(route()).toEqual({ view: 'bead', id: `mw-${n}` });
      }
    });
    And('one more Back lands on the Map', async () => {
      await back();
      expect(route()).toEqual({ view: 'map' });
    });
  });

  Scenario('mw-f758y.41 AC-1: a screen whose bead no longer exists is skipped on the way back', ({ Given, And, When, Then }) => {
    Given('he has visited the beads "mw-a.1", "mw-gone.1" and "mw-b.1"', () => {
      for (const id of ['mw-a.1', 'mw-gone.1', 'mw-b.1']) go(beadAt(id));
    });
    And('the app is closed and opened again at its bare address', async () => {
      reopen();
      await db.view.clear();
      await db.beadDetails.clear();
      setKey(new Uint8Array(32));
    });
    When('he presses Back and the backend says the bead "mw-gone.1" does not exist', async () => {
      await back();
      expect(route()).toEqual({ view: 'bead', id: 'mw-gone.1' });
      render(<BeadScreen id="mw-gone.1" />);
      await waitFor(() => expect(fetchBeadDetail).toHaveBeenCalled());
    });
    Then('the app is at the bead "mw-a.1"', async () => {
      await waitFor(() => expect(route()).toEqual({ view: 'bead', id: 'mw-a.1' }));
    });
  });

  Scenario('mw-f758y.41 AC-1: a push tap wins over the restored screen, and Back returns to the restored history', ({ Given, When, Then, And }) => {
    Given('he has visited the beads "mw-a.1" and "mw-b.1"', () => {
      go(beadAt('mw-a.1'));
      go(beadAt('mw-b.1'));
    });
    When('the app is opened by a push tap at the thread "topic:library"', () => reopen(threadAt('topic:library')));
    Then('the app opens at the thread "topic:library"', () => expect(route()).toEqual({ view: 'talk', thread: 'topic:library' }));
    And('pressing Back reaches the bead "mw-b.1"', async () => {
      await back();
      expect(route()).toEqual({ view: 'bead', id: 'mw-b.1' });
    });
    And('pressing Back reaches the bead "mw-a.1"', async () => {
      await back();
      expect(route()).toEqual({ view: 'bead', id: 'mw-a.1' });
    });
  });

  Scenario('mw-f758y.41 AC-2: each channel keeps its own scroll position across a reopen', ({ Given, When, Then, And }) => {
    Given('he has scrolled the thread "topic:one" to 300 and the thread "topic:two" to 120', () => {
      go(threadAt('topic:one'));
      render(<Harness />);
      act(() => {
        box().scrollTop = 300;
      });
      act(() => go(threadAt('topic:two')));
      act(() => {
        box().scrollTop = 120;
      });
      // Leaving the page writes what is kept (src/nav/scrollMemory.ts).
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      cleanup();
    });
    When('the app is closed and opened again at its bare address', () => reopen());
    Then('the thread "topic:two" is scrolled to 120', async () => {
      expect(route()).toEqual({ view: 'talk', thread: 'topic:two' });
      render(<Harness />);
      await waitFor(() => expect(box().scrollTop).toBe(120));
    });
    And('going Back to the thread "topic:one" scrolls it to 300', async () => {
      await act(async () => {
        await back();
      });
      expect(route()).toEqual({ view: 'talk', thread: 'topic:one' });
      await waitFor(() => expect(box().scrollTop).toBe(300));
    });
  });
});
