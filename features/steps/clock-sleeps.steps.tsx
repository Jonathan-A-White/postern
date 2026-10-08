// features/steps/clock-sleeps.steps.tsx — runs features/clock-sleeps.feature (mw-xhtcup.1):
// the real TimeAgo (useNow) and setVisibleInterval on a fake clock and a page that hides.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TimeAgo } from '../../src/ui/primitives';
import { setVisibleInterval } from '../../src/ui/visibleInterval';

const feature = await loadFeature('features/clock-sleeps.feature');
const START = new Date('2026-10-07T12:00:00Z').getTime();

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
  let renders = 0;
  let drain: ReturnType<typeof vi.fn>;
  let stop: (() => void) | undefined;

  function Counted() {
    renders += 1;
    return <TimeAgo at={START - 60_000} />;
  }

  BeforeEachScenario(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(START);
    setVisibility('visible');
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    renders = 0;
    drain = vi.fn();
  });
  AfterEachScenario(() => {
    stop?.();
    stop = undefined;
    cleanup();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    setVisibility('visible');
    vi.useRealTimers();
  });
  afterAll(() => cleanup());

  Scenario('AC-1: while Postern is in the background no clock ticks; on return the times are fresh', ({ Given, When, Then, And }) => {
    let rendersBefore = 0;
    Given('Postern shows a time that is a minute old', () => {
      render(<Counted />);
      expect(screen.getByText('1 min ago')).toBeInTheDocument();
    });
    When('Postern goes to the background for five minutes', () => {
      clearIntervalSpy.mockClear();
      setVisibility('hidden');
      rendersBefore = renders;
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
    });
    Then('no clock is running and the time has not been redrawn', () => {
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(renders).toBe(rendersBefore);
      expect(screen.getByText('1 min ago')).toBeInTheDocument();
    });
    When('Postern comes back to the foreground', () => {
      setIntervalSpy.mockClear();
      setVisibility('visible');
    });
    Then('the time reads "6 min ago" at once', () => {
      expect(screen.getByText('6 min ago')).toBeInTheDocument();
    });
    And('one clock is running again', () => {
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  Scenario('AC-2: the Later-tap drain does not run in the background and runs once on return', ({ Given, When, Then }) => {
    Given('the Later-tap drain is running every 15 seconds', () => {
      stop = setVisibleInterval(drain, 15_000);
    });
    When('Postern goes to the background for five minutes', () => {
      setVisibility('hidden');
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
    });
    Then('the drain has not run', () => {
      expect(drain).not.toHaveBeenCalled();
    });
    When('Postern comes back to the foreground', () => {
      setVisibility('visible');
    });
    Then('the drain has run once', () => {
      expect(drain).toHaveBeenCalledTimes(1);
    });
  });
});
