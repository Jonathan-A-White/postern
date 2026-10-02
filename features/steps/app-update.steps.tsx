// features/steps/app-update.steps.tsx — runs features/app-update.feature under vitest via
// @amiceli/vitest-cucumber: the real update logic (src/services/appUpdate.ts) and banner on a
// fake service worker container (tests/support/fake-registration.ts).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { startAppUpdates, UPDATE_CHECK_EVERY_MS } from '../../src/services/appUpdate';
import { UpdateBanner } from '../../src/cockpit/UpdateBanner';
import { fakeSetup, fakeWorker, type FakeSetup, type FakeWorker } from '../../tests/support/fake-registration';

const feature = await loadFeature('features/app-update.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  let setup: FakeSetup;
  let waiting: FakeWorker | undefined;
  let stop: (() => void) | undefined;

  function open(withWaiting: boolean) {
    cleanup();
    waiting = withWaiting ? fakeWorker() : undefined;
    setup = fakeSetup({ waiting });
    stop = startAppUpdates({ container: setup.container, registration: setup.registration, reload: setup.reload }).stop;
    render(<UpdateBanner />);
  }

  BeforeEachScenario(() => void vi.useFakeTimers());
  AfterEachScenario(() => {
    stop?.();
    cleanup();
    vi.useRealTimers();
  });
  afterAll(() => cleanup());

  Scenario('AC-1: a worker waiting behind the one in control shows Update ready, tap to reload', ({ Given, Then }) => {
    Given('Postern is open on a phone whose service worker has a newer build waiting', () => open(true));
    Then('the update banner reads "Update ready, tap to reload"', () => {
      expect(screen.getByRole('button', { name: 'Update ready, tap to reload' })).toBeEnabled();
    });
  });

  Scenario('AC-2: no waiting worker shows no banner', ({ Given, Then }) => {
    Given('Postern is open on a phone with nothing waiting', () => open(false));
    Then('there is no update banner', () => {
      expect(screen.queryByText('Update ready, tap to reload')).toBeNull();
    });
  });

  Scenario('AC-3: the tap tells the waiting worker to take over and the page reloads once when it has', ({ Given, When, Then, And }) => {
    Given('Postern is open on a phone whose service worker has a newer build waiting', () => open(true));
    When('he taps the update banner', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    });
    Then('the waiting worker is sent SKIP_WAITING', () => {
      expect(waiting!.postMessage).toHaveBeenCalledTimes(1);
      expect(waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });
    And('the banner goes dead and says "Updating…"', () => {
      expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    });
    When('the new worker takes control twice over', () => {
      act(() => {
        setup.controllerChanges();
        setup.controllerChanges();
      });
    });
    Then('the page has reloaded exactly once', () => {
      expect(setup.reload).toHaveBeenCalledTimes(1);
    });
  });

  Scenario('AC-4: the app looks for an update on start, on return to the foreground and every 30 minutes', ({ Given, When, Then }) => {
    Given('Postern is open on a phone with nothing waiting', () => open(false));
    Then('it has looked for an update once', () => {
      expect(setup.registration.update).toHaveBeenCalledTimes(1);
    });
    When('the phone brings Postern back to the foreground', () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Then('it has looked for an update twice', () => {
      expect(setup.registration.update).toHaveBeenCalledTimes(2);
    });
    When('30 minutes pass', () => void vi.advanceTimersByTime(UPDATE_CHECK_EVERY_MS));
    Then('it has looked for an update 3 times', () => {
      expect(setup.registration.update).toHaveBeenCalledTimes(3);
    });
  });
});
