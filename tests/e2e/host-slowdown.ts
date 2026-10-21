// tests/e2e/host-slowdown.ts — mw-gq6.684: how much slower the page's main thread runs now than on a calm host.
// A spec that holds the app to a promise in real time ("opens within 3 s") scales that time by this, so the
// host's load cannot fail it while the app running 3x slower than it did still does.
import type { Page } from '@playwright/test';

/** What SPIN takes in the page's main thread on a calm host (ms): measured on the Laptop, median of 3, at load 10 on its 16 cores (not oversubscribed). */
export const CALM_SPIN_MS = 60;

/** A fixed amount of plain CPU work in the page, timed. */
async function spinOnce(page: Page): Promise<number> {
  return page.evaluate(() => {
    const start = performance.now();
    let x = 0;
    for (let i = 0; i < 20_000_000; i++) x = (x + i * 7) % 1_000_003;
    // keeps the loop from being thrown away
    if (x < 0) throw new Error('unreachable');
    return performance.now() - start;
  });
}

/** The page's slowness right now: 1 on a calm host, 4 when the same work takes four times as long (the median of 3). */
export async function hostSlowdown(page: Page): Promise<number> {
  const runs = [await spinOnce(page), await spinOnce(page), await spinOnce(page)].sort((a, b) => a - b);
  return Math.max(1, runs[1] / CALM_SPIN_MS);
}
