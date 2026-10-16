// tests/unit/todo-kept.test.ts — mw-ev7oyy.16, mw-ht6gsw.5: what the To do board keeps on the phone: whether he has opened Later and Let go,
// and the cards he has tapped into Today (for that day only). The suite runs with TZ=UTC.
import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey, isRowOpen, keepRowOpen, keepTodayPick, readRowsOpen, readTodayPicks } from '../../src/todo';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const TOMORROW = NOW + 86_400_000;

beforeEach(() => localStorage.clear());

describe('the rows he has opened or folded', () => {
  it('has Later and Let go folded until he says', () => {
    const open = readRowsOpen();
    expect([isRowOpen(open, 'later'), isRowOpen(open, 'let-go')]).toEqual([false, false]);
  });

  it('keeps a choice for each row, across a read', () => {
    keepRowOpen(keepRowOpen(readRowsOpen(), 'later', true), 'let-go', true);
    keepRowOpen(readRowsOpen(), 'let-go', false);
    const open = readRowsOpen();
    expect([isRowOpen(open, 'later'), isRowOpen(open, 'let-go')]).toEqual([true, false]);
  });

  it('reads damaged storage as the defaults', () => {
    localStorage.setItem('postern.todo.folds', '[1,2');
    expect(isRowOpen(readRowsOpen(), 'later')).toBe(false);
    localStorage.setItem('postern.todo.folds', JSON.stringify({ later: 'yes', 'let-go': true }));
    const open = readRowsOpen();
    expect([isRowOpen(open, 'later'), isRowOpen(open, 'let-go')]).toEqual([false, true]);
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
