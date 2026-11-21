// features/steps/shots-retries.steps.ts — runs features/shots-retries.feature: the reporter and the last line of `npm run shots`.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { countRetried, retriedLine } from '../../scripts/shots-retries.mjs';
import DetachedRetriesReporter from '../../tests/support/detached-retries-reporter';
import { DETACHED_SETUP_WORDS } from '../../tests/support/page-setup-watch';

const feature = await loadFeature('features/shots-retries.feature');

describeFeature(feature, ({ Scenario }) => {
  function run(message: string) {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'shots-retries-')), 'retried.txt');
    const saved = process.env.SHOTS_RETRIES_FILE;
    process.env.SHOTS_RETRIES_FILE = file;
    const test = { retries: 1, titlePath: () => ['', 'shots', 'talk.spec.ts', 'talk line'] } as never;
    new DetachedRetriesReporter().onTestEnd(test, { retry: 0, status: 'failed', errors: [{ message }] } as never);
    if (saved === undefined) delete process.env.SHOTS_RETRIES_FILE;
    else process.env.SHOTS_RETRIES_FILE = saved;
    return file;
  }
  const lastLine = (file: string) => {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // the reporter wrote nothing
    }
    return retriedLine([
      { size: '390x844', retried: countRetried(text) },
      { size: '360x640', retried: 0 },
      { size: '1280x800', retried: 0 },
    ]);
  };

  Scenario("AC-1: the last line of a shots run says how many tests were retried for a detached page", ({ Given, And, When, Then }) => {
    let file = '';
    let line = '';
    Given("the first attempt of a test was ended because its page's target detached during setup", () => {
      file = run(`page-setup-watch: ${DETACHED_SETUP_WORDS} (Render process gone.)`);
    });
    And('the test is run again', () => {
      // the config's one retry is the runner's; the reporter has already noted the first attempt
    });
    When('the shots run ends', () => {
      line = lastLine(file);
    });
    Then('its last line reads "shots: 1 test retried for a detached page (390x844: 1)"', () => {
      expect(line).toBe('shots: 1 test retried for a detached page (390x844: 1)');
    });
  });

  Scenario('AC-1: a failure of another kind is not counted', ({ Given, When, Then }) => {
    let file = '';
    let line = '';
    Given('the first attempt of a test failed on an assertion', () => {
      file = run('expect(received).toBe(expected)');
    });
    When('the shots run ends', () => {
      line = lastLine(file);
    });
    Then('its last line reads "shots: 0 tests retried for a detached page"', () => {
      expect(line).toBe('shots: 0 tests retried for a detached page');
    });
  });
});
