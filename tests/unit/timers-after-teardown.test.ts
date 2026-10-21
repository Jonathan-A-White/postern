// tests/unit/timers-after-teardown.test.ts — Postern's two module-level timers fire into a page that is
// gone (mw-gq6.680). vitest removes jsdom's globals at the end of a test file; a timer still pending then
// runs with no `window` and throws 'window is not defined' (an uncaught error that fails a green run).
// scrollMemory's keepSoon (250 ms after a scroll) and dbTrouble's reload (1.5 s after another window upgraded
// the database) are both module-level, so no screen's cleanup cancels them. Each test ends with its trigger as
// the last action, closes the page as teardown does (pwa-kit/test-preset's settleAfterTeardown takes `window`
// away) and moves the clock to the timer's moment. The clock is faked so the timer fires inside that window.
import { createElement } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAfterTeardown } from 'pwa-kit/test-preset';
import { forgetScrolls, useScrollMemory } from '../../src/nav/scrollMemory';
import { RELOAD_AFTER_MS, getDbTrouble, noteDbChanged, resetDbTrouble } from '../../src/data/dbTrouble';

/** Runs the fake clock to `ms` with `window` gone; returns what the timer raised, thrown or uncaught. */
async function fireAfterTeardown(ms: number): Promise<unknown[]> {
  const thrown: unknown[] = [];
  const raised = await settleAfterTeardown(() => {
    try {
      vi.advanceTimersByTime(ms);
    } catch (error) {
      thrown.push(error);
    }
  });
  return [...thrown, ...raised];
}

const reasons = (errors: unknown[]) => errors.map((error) => (error instanceof Error ? error.message : String(error)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  forgetScrolls();
  resetDbTrouble();
  vi.useRealTimers();
});

describe('scrollMemory: the write to the phone 250 ms after the last scroll', () => {
  it('mw-gq6.680: a scroll as the last action leaves no error when the page is gone before the timer fires', async () => {
    window.history.replaceState(null, '', '/?v=first');
    function Box() {
      const remember = useScrollMemory('page');
      return createElement('div', { 'data-testid': 'box', ref: remember });
    }
    const { getByTestId } = render(createElement(Box));
    // The box is wired in an effect after a state change: let React finish before the scroll.
    await vi.advanceTimersByTimeAsync(0);
    const box = getByTestId('box');
    box.scrollTop = 40;
    fireEvent.scroll(box);
    cleanup();

    expect(reasons(await fireAfterTeardown(300))).toEqual([]);
  });
});

describe('dbTrouble: the reload 1.5 s after another window upgraded the database', () => {
  it('mw-gq6.680: a database changed under the page as the last action leaves no error when the page is gone before the reload', async () => {
    resetDbTrouble();
    noteDbChanged();
    expect(getDbTrouble()).toBe('changed');

    expect(reasons(await fireAfterTeardown(RELOAD_AFTER_MS + 100))).toEqual([]);
  });
});
