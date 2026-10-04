// tests/unit/last-route.test.ts — mw-f758y.31: the last address is kept on a move and read on
// start; places that answer one event are not kept; a named address is left alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isKeptSearch, readLastRoute, readScrolls, restoreLastRoute, saveLastRoute, saveScrolls, takeRestoredBead } from '../../src/nav/lastRoute';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('the last route', () => {
  it('keeps the address of a screen and reads it back', () => {
    saveLastRoute('?v=talk&t=topic%3Alibrary');
    expect(readLastRoute()).toBe('?v=talk&t=topic%3Alibrary');
  });

  it('does not keep a push landing, a parked share, the key page or a bare address', () => {
    saveLastRoute('?v=bead&id=mw-x');
    for (const search of ['', '?v=notice&tx=ab', '?v=alarm&title=x', '?v=share&s=1', '?v=key']) {
      saveLastRoute(search);
      expect(isKeptSearch(search)).toBe(false);
    }
    expect(readLastRoute()).toBe('?v=bead&id=mw-x');
  });

  it('puts a bare address back at the kept one, and remembers a bead for the fallback', () => {
    saveLastRoute('?v=bead&id=mw-x');
    restoreLastRoute();
    expect(window.location.search).toBe('?v=bead&id=mw-x');
    expect(takeRestoredBead('mw-other')).toBe(false);
    expect(takeRestoredBead('mw-x')).toBe(true);
    expect(takeRestoredBead('mw-x')).toBe(false);
  });

  it('leaves an address that names a place alone (a push tap wins)', () => {
    saveLastRoute('?v=bead&id=mw-x');
    window.history.replaceState(null, '', '/?v=needs');
    restoreLastRoute();
    expect(window.location.search).toBe('?v=needs');
  });

  it('opens bare when nothing was kept, or storage is refused', () => {
    restoreLastRoute();
    expect(window.location.search).toBe('');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => saveLastRoute('?v=me')).not.toThrow();
  });
});

describe('the kept scroll offsets', () => {
  it('are read back only for the address they were kept at, and only that address\'s boxes', () => {
    saveScrolls(
      new Map([
        ['?v=bead&id=a#page', 300],
        ['?v=bead&id=b#page', 50],
        ['list', 7],
      ]),
      '?v=bead&id=a',
    );
    expect(readScrolls('?v=bead&id=a')).toEqual([
      ['?v=bead&id=a#page', 300],
      ['list', 7],
    ]);
    expect(readScrolls('?v=bead&id=b')).toEqual([]);
  });
});
