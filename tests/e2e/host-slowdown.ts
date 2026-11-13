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

/**
 * mw-gq6.908: the reading around a timed tap, for a spec that taps many times. A reading is hostSlowdown's three spins,
 * and on a browser slowed 20x at host 33x those cost 5-20 s on the wall (the in-page spin 1-2.5 s, plus the round trip of
 * each evaluate), six of them around every tap: 20 s or more of every tap. The tap before ended on a reading, so
 * the next tap starts from it (`before`) and reads only once, after itself (`after`). The first tap has none and reads.
 */
export class HostWatch {
  private last: number | undefined;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The slowness the last reading found, read now only if there has been none. */
  async before(): Promise<number> {
    return this.last ?? this.after();
  }

  /** A reading now (three spins). */
  async after(): Promise<number> {
    this.last = await hostSlowdown(this.page);
    return this.last;
  }
}

/** The slowest the host was at any stretch of a window, read by a page of its own while another page is timed (mw-6ww.175.33). */
export interface HostWindow {
  /** Ends the readings and gives the window's worst: the largest median of three readings in a row (1 on a calm host). */
  stop(): Promise<number>;
}

/**
 * mw-6ww.175.33: the host as it was DURING a window, not at its two ends. A send of a 2 MB photo takes 15 to 25 s on a loaded host, and
 * another worker's 20x test that started in the middle of it was seen by neither the reading before it (1.3x) nor the one after (1.4x):
 * the page's longest task, 1942 ms, then met a promise scaled by 1.4x. A second page of the same browser, with no slowing on it, spins
 * on every quarter second until `stop`; its worst stretch scales the promise with the two ends.
 */
export async function watchHostSlowdown(page: Page): Promise<HostWindow> {
  const helper = await page.context().newPage();
  const spins: number[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        spins.push(await spinOnce(helper));
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await helper.close().catch(() => undefined);
      const runs = spins.length < 3 ? [Math.max(...spins, 0)] : spins.slice(2).map((_, i) => [...spins.slice(i, i + 3)].sort((a, b) => a - b)[1]);
      return Math.max(1, ...runs.map((ms) => ms / CALM_SPIN_MS));
    },
  };
}
