// tests/unit/history-trail.test.ts — mw-f758y.41: the last 20 addresses are kept, a reload keeps the
// history it still has, and each address keeps its own scroll offsets (the last 20 of them).
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetTrail, KEPT_ADDRESSES, readAllScrolls, readScrolls, restoreLastRoute, saveLastRoute, saveScrolls } from '../../src/nav/lastRoute';
import { navigate } from '../../src/router';

beforeEach(() => {
  localStorage.clear();
  forgetTrail();
  window.history.replaceState(null, '', '/');
});

function go(search: string): void {
  navigate(search);
  saveLastRoute(window.location.search);
}

const kept = () => JSON.parse(localStorage.getItem('postern.trail') ?? '[]') as string[];

describe('the kept trail', () => {
  it('keeps the last 20 of 25 screens, oldest first', () => {
    for (let n = 1; n <= 25; n++) go(`?v=bead&id=mw-${n}`);
    expect(kept()).toHaveLength(KEPT_ADDRESSES);
    expect(kept()[0]).toBe('?v=bead&id=mw-6');
    expect(kept()[19]).toBe('?v=bead&id=mw-25');
  });

  it('leaves out a push landing and a screen shown twice in a row', () => {
    go('?v=me');
    go('?v=alarm&title=x');
    go('?v=me');
    expect(kept()).toEqual(['?v=me']);
  });

  it('stops at the screen he is on after he went Back', async () => {
    go('?v=me');
    go('?v=search');
    go('?v=talk&t=general');
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history.back();
    });
    saveLastRoute(window.location.search);
    expect(kept()).toEqual(['?v=me', '?v=search']);
  });

  it('is not rebuilt on a reload of a named address: the history is still there', () => {
    go('?v=me');
    go('?v=search');
    const length = window.history.length;
    forgetTrail();
    restoreLastRoute();
    expect(window.location.search).toBe('?v=search');
    expect(window.history.length).toBe(length);
  });

  it('is rebuilt on a cold start, the Map under the oldest screen', () => {
    go('?v=me');
    window.history.replaceState(null, '', '/');
    forgetTrail();
    const before = window.history.length;
    restoreLastRoute();
    expect(window.location.search).toBe('?v=me');
    expect(window.history.length).toBe(before + 1);
  });
});

describe('the kept scroll offsets of every address', () => {
  it('keep each address its own, and read back together with the current address last', () => {
    saveScrolls(new Map([['?v=talk&t=a#channel', 300]]), '?v=talk&t=a');
    saveScrolls(new Map([['?v=talk&t=a#channel', 300], ['?v=talk&t=b#channel', 120], ['list', 7]]), '?v=talk&t=b');
    expect(readScrolls('?v=talk&t=a')).toEqual([['?v=talk&t=a#channel', 300]]);
    expect(readAllScrolls('?v=talk&t=b')).toEqual([
      ['?v=talk&t=a#channel', 300],
      ['?v=talk&t=b#channel', 120],
      ['list', 7],
    ]);
  });

  it('are kept for the last 20 addresses only', () => {
    for (let n = 1; n <= 25; n++) saveScrolls(new Map([[`?v=bead&id=mw-${n}#page`, n]]), `?v=bead&id=mw-${n}`);
    expect(readScrolls('?v=bead&id=mw-5')).toEqual([]);
    expect(readScrolls('?v=bead&id=mw-6')).toEqual([['?v=bead&id=mw-6#page', 6]]);
  });
});
