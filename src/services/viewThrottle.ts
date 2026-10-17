// src/services/viewThrottle.ts — the one throttle on the whole view's fetch (mw-7dige5.4): what
// src/services/view.ts reads and writes, kept in a leaf of its own so a test's setup can forget it
// without loading the view service.
import type { RefreshViewOptions } from './view';

/** The least time between two full fetches of the view. */
export const VIEW_MIN_INTERVAL_MS = 60_000;

/** The least time between two full fetches made only because the events named something the home builds (a
 * hold, a landing, a story closed): in a busy factory there is one of those nearly every minute (mw-7dige5.5). */
export const VIEW_BEHIND_INTERVAL_MS = 15 * 60_000;

/** How long after an event that raises a card only the home builds the phone waits for the home's `view` event before
 * it asks for the view anyway: the home publishes about 27 s after the beads change (mw-gq6.476), and the event batch
 * may come before or after that (mw-ev7oyy.39). */
export const HOME_PUBLISH_WAIT_MS = 30_000;

export const viewThrottle: {
  /** When the view was last asked for (performance.now(), ms); -Infinity before the first. */
  lastFetchAt: number;
  /** The fetch waiting for its window to end: when it is due (performance.now(), ms), with the options it will use. */
  trailing: { timer: ReturnType<typeof setTimeout>; due: number; options: RefreshViewOptions } | undefined;
  /** The wait for the home to publish the view with a card an event named: the options the fetch will use, and the
   * timer that fetches if the home's `view` event does not come first (mw-ev7oyy.39). */
  expected: { timer: ReturnType<typeof setTimeout>; options: RefreshViewOptions } | undefined;
} = { lastFetchAt: -Infinity, trailing: undefined, expected: undefined };

/** Forgets the throttle: the next call fetches at once. For a new session, and for tests. */
export function resetViewThrottle(): void {
  if (viewThrottle.trailing) clearTimeout(viewThrottle.trailing.timer);
  viewThrottle.trailing = undefined;
  if (viewThrottle.expected) clearTimeout(viewThrottle.expected.timer);
  viewThrottle.expected = undefined;
  viewThrottle.lastFetchAt = -Infinity;
}
