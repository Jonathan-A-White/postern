// mw-j0f2d.42: Me's Notifications block reads the notification settings and the push
// subscription when it mounts. A read that lands after the screen is gone must set no
// state: after the test file's jsdom is torn down, a late setState throws 'window is
// not defined' (an unhandled error that refused an unrelated landing).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { settingsRepo } from '../../src/data/repositories';
import * as push from '../../src/services/push';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/push/classOptions';

afterAll(() => cleanup());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A promise-like whose continuation the test fires by hand, so a result can arrive at a moment of its choosing. */
function held<T>(value: T) {
  let continuation: ((v: T) => unknown) | undefined;
  const thenable = {
    then(onFulfilled: (v: T) => unknown) {
      continuation = onFulfilled;
      return thenable;
    },
  };
  return { thenable: thenable as unknown as Promise<T>, arrive: () => continuation?.(value), wasAsked: () => continuation !== undefined };
}

describe('Me, a result that arrives after the screen is gone', () => {
  it('sets no state when the notification settings arrive after unmount', async () => {
    const settings = held(DEFAULT_NOTIFICATION_SETTINGS);
    vi.spyOn(settingsRepo, 'getNotificationSettings').mockReturnValue(settings.thenable);
    const subscribed = held(false);
    vi.spyOn(push, 'isPushSubscribed').mockReturnValue(subscribed.thenable);

    const { unmount } = render(<MeScreen />);
    expect(await screen.findByText(`Postern v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(settings.wasAsked()).toBe(true);
    expect(subscribed.wasAsked()).toBe(true);
    unmount();

    // With no window (the torn-down environment) a state update throws; a result that is ignored touches nothing.
    vi.stubGlobal('window', undefined);
    expect(() => settings.arrive()).not.toThrow();
    expect(() => subscribed.arrive()).not.toThrow();
  });
});
