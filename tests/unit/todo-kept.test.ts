// tests/unit/todo-kept.test.ts — mw-ev7oyy.16: what the To do board keeps on the phone: which groups of each list he has opened or folded,
// and the cards he has tapped into Today (for that day only). The suite runs with TZ=UTC.
import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey, isGroupOpen, keepGroupOpen, keepTodayPick, readGroupsOpen, readTodayPicks } from '../../src/todo';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const TOMORROW = NOW + 86_400_000;

beforeEach(() => localStorage.clear());

describe('the groups he has opened or folded', () => {
  it('has Today open and Soon and Someday folded until he says', () => {
    const open = readGroupsOpen();
    expect(['today', 'soon', 'someday'].map((group) => isGroupOpen(open, 'mw-a', group as 'today'))).toEqual([true, false, false]);
  });

  it('keeps a choice per list, across a read', () => {
    keepGroupOpen(keepGroupOpen(readGroupsOpen(), 'mw-a', 'soon', true), 'mw-a', 'today', false);
    const open = readGroupsOpen();
    expect(['today', 'soon', 'someday'].map((group) => isGroupOpen(open, 'mw-a', group as 'today'))).toEqual([false, true, false]);
    expect(isGroupOpen(open, 'mw-b', 'soon')).toBe(false);
  });

  it('reads damaged storage as the defaults', () => {
    localStorage.setItem('postern.todo.groups', '[1,2');
    expect(isGroupOpen(readGroupsOpen(), 'mw-a', 'today')).toBe(true);
    localStorage.setItem('postern.todo.groups', JSON.stringify({ 'mw-a': { soon: 'yes', today: false }, 'mw-b': 3 }));
    const open = readGroupsOpen();
    expect([isGroupOpen(open, 'mw-a', 'soon'), isGroupOpen(open, 'mw-a', 'today'), isGroupOpen(open, 'mw-b', 'today')]).toEqual([false, false, true]);
  });
});

describe('the cards tapped into Today', () => {
  it('keeps a tap for the day it was made, and not for the next', () => {
    keepTodayPick('mw-a.1', true, NOW);
    expect(readTodayPicks(NOW)).toEqual({ 'mw-a.1': dayKey(NOW) });
    expect(readTodayPicks(TOMORROW)).toEqual({});
  });

  it("drops the other days' taps when one is made, and puts a card back", () => {
    keepTodayPick('mw-a.1', true, NOW);
    keepTodayPick('mw-a.2', true, TOMORROW);
    expect(Object.keys(JSON.parse(localStorage.getItem('postern.todo.today') as string))).toEqual(['mw-a.2']);
    expect(keepTodayPick('mw-a.2', false, TOMORROW)).toEqual({});
  });
});
