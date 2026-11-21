// tests/support/detached-retries-reporter.ts — mw-6ww.175.61: the watch (page-setup-watch.ts) stops a page setup whose target
// detached ('Render process gone.') and keeps that test for the config's one retry. Such a test then shows only as 'flaky' in
// the run's list, and nothing counted them across runs. This reporter notes each test whose first attempt was ended that way
// and was run again, one line per test, in the file named by SHOTS_RETRIES_FILE (scripts/run-shots.mjs reads it and puts the
// count on the last line of `npm run shots`). With no SHOTS_RETRIES_FILE it does nothing.
import { appendFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { DETACHED_SETUP_WORDS } from './page-setup-watch';

/** True when a test attempt's error is the watch's stop for a detached page (and so the attempt was left retriable). */
export function endedByDetachedPage(result: Pick<TestResult, 'errors' | 'error'>): boolean {
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  return errors.some((error) => (error.message ?? '').includes(DETACHED_SETUP_WORDS));
}

export default class DetachedRetriesReporter implements Reporter {
  private readonly file = process.env.SHOTS_RETRIES_FILE;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.file) return;
    if (result.retry >= test.retries || result.status === 'passed' || !endedByDetachedPage(result)) return;
    appendFileSync(this.file, `${test.titlePath().filter(Boolean).join(' › ')}\n`);
  }
}
