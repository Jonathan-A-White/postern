// tests/e2e/needs-badge.ts — mw-gq6.902: waiting for the Needs you tab's count.
// On a browser slowed 20x at host load 54 the stored view took 21 s to decode and count, past Playwright's 20 s expect
// timeout (360x640, 2026-11-03). The wait is for the badge, not a promise about speed (the timed taps are), so it is
// given as long as it needs and returns the moment the badge shows; a badge that never shows fails with the page's
// address and its text in the message, so the reader sees what the app showed instead.
import { expect, type Page } from '@playwright/test';

/** How long a browser slowed 20x may take to show the badge once the view has arrived (ms). The wait ends when it shows. */
export const SLOWED_WAIT_MS = 120_000;

const PAGE_TEXT_CHARS = 600;

/** Resolves as soon as the Needs you tab shows its count; rejects after `timeoutMs` saying what the page showed. */
export async function needsBadgeShows(page: Page, timeoutMs?: number): Promise<void> {
  try {
    await expect(page.getByRole('link', { name: /Needs you/ }).getByText(/^\d+\+?$/)).toBeVisible({ timeout: timeoutMs });
  } catch (cause) {
    const text = await page.locator('body').innerText({ timeout: 20_000 }).catch(() => '(the page text could not be read)');
    const shown = text.replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_CHARS);
    throw new Error(
      `the Needs you badge was not shown within ${timeoutMs ?? 'the default'} ms. Page ${page.url()} showed: ${shown}\n${(cause as Error).message}`,
    );
  }
}
