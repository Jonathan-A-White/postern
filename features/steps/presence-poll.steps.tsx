// features/steps/presence-poll.steps.tsx — runs features/presence-poll.feature (mw-1ox07o.4): the real
// useMayorHere hook under fake timers, with the presence service and the unlocked key as doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, renderHook } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { useMayorHere } from '../../src/cockpit/useMayorHere';

const asked = vi.fn<(key: Uint8Array) => Promise<boolean | undefined>>(() => Promise.resolve(true));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: (key: Uint8Array) => asked(key) }));
const KEY = new Uint8Array(32).fill(7);
vi.mock('../../src/cockpit/hooks', () => ({ useUnlockedKey: () => KEY }));

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

let waiting = true;
let screen: ReturnType<typeof renderHook<boolean | undefined, { waiting: boolean }>> | undefined;

async function pass(seconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
}

async function openScreen(isWaiting: boolean): Promise<void> {
  cleanup();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  visibility = 'visible';
  waiting = isWaiting;
  asked.mockClear();
  await act(async () => {
    screen = renderHook(({ waiting: w }) => useMayorHere(w), { initialProps: { waiting } });
  });
}

const feature = await loadFeature('features/presence-poll.feature');

describeFeature(feature, ({ AfterAllScenarios, AfterEachScenario, Scenario }) => {
  AfterEachScenario(() => {
    cleanup();
    vi.useRealTimers();
  });
  AfterAllScenarios(() => cleanup());

  Scenario('mw-1ox07o.4 AC-1: while the line waits for the Mayor the presence is asked every 5 s', ({ Given, When, Then }) => {
    Given('the Talk screen is open and the line is waiting for the Mayor', () => openScreen(true));
    When('31 seconds pass', () => pass(31));
    Then('the presence was asked 7 times', () => expect(asked).toHaveBeenCalledTimes(7));
  });

  Scenario('mw-1ox07o.4 AC-2: while the line is not waiting the presence is asked every 30 s', ({ Given, When, Then }) => {
    Given('the Talk screen is open and the line is idle', () => openScreen(false));
    When('95 seconds pass', () => pass(95));
    Then('the presence was asked 4 times', () => expect(asked).toHaveBeenCalledTimes(4));
  });

  Scenario('mw-1ox07o.4 AC-3: a hidden page asks nothing, and asks at once when it is visible again', ({ Given, When, Then }) => {
    Given('the Talk screen is open and the line is waiting for the Mayor', () => openScreen(true));
    When('the page is hidden and 120 seconds pass', async () => {
      visibility = 'hidden';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await pass(120);
    });
    Then('the presence was asked 1 time', () => expect(asked).toHaveBeenCalledTimes(1));
    When('the page becomes visible', async () => {
      visibility = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    });
    Then('the presence was asked 2 times', () => expect(asked).toHaveBeenCalledTimes(2));
  });

  Scenario('mw-1ox07o.4 AC-4: the poll slows to 30 s when the wait ends, and the timer is cleared when the screen closes', ({ Given, When, Then }) => {
    Given('the Talk screen is open and the line is waiting for the Mayor', () => openScreen(true));
    When('the line stops waiting and 65 seconds pass', async () => {
      await act(async () => {
        screen?.rerender({ waiting: false });
      });
      await pass(65);
    });
    Then('the presence was asked 4 times', () => expect(asked).toHaveBeenCalledTimes(4));
    When('the Talk screen closes and 120 seconds pass', async () => {
      await act(async () => {
        screen?.unmount();
      });
      await pass(120);
    });
    Then('the presence has still been asked 4 times', () => expect(asked).toHaveBeenCalledTimes(4));
  });
});
