// src/services/viewThrottle.ts — the one throttle on the whole view's fetch (mw-7dige5.4): what
// src/services/view.ts reads and writes, kept in a leaf of its own so a test's setup can forget it
// without loading the view service.
import type { RefreshViewOptions } from './view';

/** The least time between two full fetches of the view. */
export const VIEW_MIN_INTERVAL_MS = 60_000;

export const viewThrottle: {
  /** When the view was last asked for (performance.now(), ms); -Infinity before the first. */
  lastFetchAt: number;
  /** The fetch waiting for the window to end, with the options it will use. */
  trailing: { timer: ReturnType<typeof setTimeout>; options: RefreshViewOptions } | undefined;
} = { lastFetchAt: -Infinity, trailing: undefined };

/** Forgets the throttle: the next call fetches at once. For a new session, and for tests. */
export function resetViewThrottle(): void {
  if (viewThrottle.trailing) clearTimeout(viewThrottle.trailing.timer);
  viewThrottle.trailing = undefined;
  viewThrottle.lastFetchAt = -Infinity;
}
