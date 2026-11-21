// @vitest-environment node
//
// mw-6ww.175.61: the last line of `npm run shots` says how many tests were run again because their page's target detached
// during setup. The reporter (tests/support/detached-retries-reporter.ts) notes each such test; scripts/shots-retries.mjs
// counts them and words the line.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countRetried, retriedLine } from '../../scripts/shots-retries.mjs';
import DetachedRetriesReporter, { endedByDetachedPage } from '../support/detached-retries-reporter';
import { DETACHED_SETUP_WORDS, PageSetupWatch } from '../support/page-setup-watch';

const stoppedError = { message: `page-setup-watch: ${DETACHED_SETUP_WORDS} (Render process gone.): stopped after 3 s` };

function attempt(over: { retry: number; status: string; errors: { message: string }[] }) {
  return over as never;
}
function test_(retries = 1, title = 'talk line') {
  return { retries, titlePath: () => ['', 'shots', 'talk.spec.ts', title] } as never;
}

describe('the words of a stopped setup', () => {
  it("are the ones PageSetupWatch.stopSetup's error carries", () => {
    const watch = new PageSetupWatch({ worker: '0', now: () => 0, readHost: () => ({}), say: () => {} });
    expect(watch.stopSetup('Render process gone.')).toContain(DETACHED_SETUP_WORDS);
  });
});

describe('endedByDetachedPage', () => {
  it('is true for the watch\'s stop and false for any other failure', () => {
    expect(endedByDetachedPage({ errors: [stoppedError] } as never)).toBe(true);
    expect(endedByDetachedPage({ errors: [{ message: 'Timeout 60000ms exceeded' }] } as never)).toBe(false);
    expect(endedByDetachedPage({ errors: [] } as never)).toBe(false);
  });
});

describe('DetachedRetriesReporter', () => {
  const saved = process.env.SHOTS_RETRIES_FILE;
  afterEach(() => {
    if (saved === undefined) delete process.env.SHOTS_RETRIES_FILE;
    else process.env.SHOTS_RETRIES_FILE = saved;
  });
  const fileFor = () => path.join(mkdtempSync(path.join(tmpdir(), 'retries-')), 'retried.txt');
  const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

  it('notes a test whose first attempt a detached page ended and that is run again', () => {
    const file = fileFor();
    process.env.SHOTS_RETRIES_FILE = file;
    new DetachedRetriesReporter().onTestEnd(test_(), attempt({ retry: 0, status: 'failed', errors: [stoppedError] }));
    expect(countRetried(read(file))).toBe(1);
    expect(read(file)).toContain('talk line');
  });

  it('does not note a failure of another kind, a pass, or the last attempt, which is not run again', () => {
    const file = fileFor();
    process.env.SHOTS_RETRIES_FILE = file;
    const reporter = new DetachedRetriesReporter();
    reporter.onTestEnd(test_(), attempt({ retry: 0, status: 'failed', errors: [{ message: 'expect(received).toBe(expected)' }] }));
    reporter.onTestEnd(test_(), attempt({ retry: 1, status: 'passed', errors: [] }));
    reporter.onTestEnd(test_(), attempt({ retry: 1, status: 'failed', errors: [stoppedError] }));
    expect(read(file)).toBe('');
  });

  it('writes nothing when no file is named', () => {
    delete process.env.SHOTS_RETRIES_FILE;
    expect(() => new DetachedRetriesReporter().onTestEnd(test_(), attempt({ retry: 0, status: 'failed', errors: [stoppedError] }))).not.toThrow();
  });
});

describe('countRetried', () => {
  it('counts the non-empty lines', () => {
    expect(countRetried('')).toBe(0);
    expect(countRetried('a\nb\n\n')).toBe(2);
  });
});

describe('retriedLine', () => {
  const sizes = ['390x844', '360x640', '1280x800'];
  it('says none when no test was retried', () => {
    expect(retriedLine(sizes.map((size) => ({ size, retried: 0 })))).toBe('shots: 0 tests retried for a detached page');
  });
  it('says one test, and at which size', () => {
    expect(retriedLine(sizes.map((size, i) => ({ size, retried: i === 1 ? 1 : 0 })))).toBe('shots: 1 test retried for a detached page (360x640: 1)');
  });
  it('adds up the sizes', () => {
    expect(retriedLine(sizes.map((size, i) => ({ size, retried: i < 2 ? 2 : 0 })))).toBe('shots: 4 tests retried for a detached page (390x844: 2, 360x640: 2)');
  });
});
