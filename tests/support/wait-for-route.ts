import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { parseRoute, type Route } from '../../src/nav/route';

/** How long a step waits on something that follows a fetch: waitFor's default 1 s gives up on a loaded host. */
export const SLOW_HOST_MS = 10_000;

/** Wait until the address bar names `expected`; on timeout the error names the route actually seen. */
export async function waitForRoute(expected: Route, timeout: number = SLOW_HOST_MS): Promise<void> {
  try {
    await waitFor(() => expect(parseRoute(window.location.search)).toEqual(expected), { timeout });
  } catch (err) {
    const seen = JSON.stringify(parseRoute(window.location.search));
    throw new Error(`expected route ${JSON.stringify(expected)} within ${timeout} ms, route seen: ${seen} (${window.location.search})`, {
      cause: err,
    });
  }
}
