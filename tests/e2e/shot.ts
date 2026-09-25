// tests/e2e/shot.ts — mw-eqhpw.1: one full-page screenshot per e2e spec, taken
// at whatever viewport the running Playwright project sets (the 'shots'
// project in playwright.config.ts uses a 390px iPhone width), written where
// `npm run shots:publish` picks them up.
import type { Page } from '@playwright/test';

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/shots/${name}.png`, fullPage: true });
}
