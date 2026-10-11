// tests/e2e/shot.ts — mw-eqhpw.1, mw-s6387p.1: every e2e spec's screenshot, written where
// `npm run shots:publish` picks them up: test-results/shots/<size>/<name>.png.
//
// `npm run shots` runs the whole suite once per size (390x844 phone, 360x640 small phone, 1280x800
// desktop), setting SHOT_SIZE for each run. A spec fixes its own viewport with test.use(), which
// beats the project's, so a spec wraps that viewport in sized(): under SHOT_SIZE it is the size
// being shot, otherwise the spec's own. (Resizing a page mid-test would not do: at 1024 px and up
// the app swaps to its two-pane layout and drops what the spec had open.)
import { test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { shotSize, type Viewport } from '../support/shot-size';

export const SHOT_DIR = 'test-results/shots';

export function sized(own: Viewport): Viewport {
  return shotSize() ?? own;
}

// Without `of`, the full page; with it, that element only. Taken only by the 'shots' project
// (a plain e2e run has no use for them). The folder is the size being shot, or, outside
// `npm run shots` (the gate's one 390 px run), the page's own.
export async function shot(page: Page, name: string, of?: Locator): Promise<void> {
  if (test.info().project.name !== 'shots') return;
  const asked = shotSize();
  const size = asked ?? page.viewportSize();
  if (!size) throw new Error(`shot(${name}): the page has no viewport`);
  const actual = page.viewportSize();
  if (asked && (actual?.width !== asked.width || actual?.height !== asked.height)) {
    throw new Error(`shot(${name}): asked for ${asked.width}x${asked.height} but the page is ${actual?.width}x${actual?.height}; wrap the spec's viewport in sized()`);
  }
  const path = `${SHOT_DIR}/${size.width}x${size.height}/${name}.png`;
  if (of) await of.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}
