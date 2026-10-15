// tests/unit/todo-due.test.ts — mw-ev7oyy.9: how a To do card's due time reads on its face, when it is past,
// how the date-time input's value and the wire's UTC time turn into each other, and the order 'Sort by due' gives.
// The suite runs with TZ=UTC, so a local time is a UTC time here.
import { describe, expect, it } from 'vitest';
import { byDue, dueToInput, dueWords, formatDue, inputToDue, isOverdue, isPastDue, sortByDue } from '../../src/todo';
import type { TodoCard } from '../../src/todo';

// Tuesday 2026-10-13, 12:00 UTC.
const NOW = Date.parse('2026-10-13T12:00:00Z');

describe('formatDue: the due time as it reads on the card', () => {
  it('says Today with the 24-hour time for a time later today', () => {
    expect(formatDue('2026-10-13T17:00:00Z', NOW)).toBe('Today 17:00');
  });

  it('drops the leading zero of the hour and keeps the minutes', () => {
    expect(formatDue('2026-10-13T09:05:00Z', NOW)).toBe('Today 9:05');
  });

  it('says Tomorrow and Yesterday for the days either side', () => {
    expect(formatDue('2026-10-14T09:00:00Z', NOW)).toBe('Tomorrow 9:00');
    expect(formatDue('2026-10-12T18:30:00Z', NOW)).toBe('Yesterday 18:30');
  });

  it('gives the weekday for a time between two and six days ahead', () => {
    expect(formatDue('2026-10-15T09:00:00Z', NOW)).toBe('Thu 9:00');
    expect(formatDue('2026-10-19T14:00:00Z', NOW)).toBe('Mon 14:00');
  });

  it('gives the date for anything further off, or earlier than yesterday', () => {
    expect(formatDue('2026-10-20T09:00:00Z', NOW)).toBe('Oct 20 9:00');
    expect(formatDue('2026-10-10T09:00:00Z', NOW)).toBe('Oct 10 9:00');
  });

  it('adds the year when the date is not this year', () => {
    expect(formatDue('2027-01-05T08:00:00Z', NOW)).toBe('Jan 5 2027 8:00');
  });

  it('reads a time that is no time as nothing', () => {
    expect(formatDue('soon', NOW)).toBe('');
  });
});

describe('isPastDue', () => {
  it('is false before the time, true from the minute it arrives', () => {
    expect(isPastDue('2026-10-13T12:00:01Z', NOW)).toBe(false);
    expect(isPastDue('2026-10-13T12:00:00Z', NOW)).toBe(true);
    expect(isPastDue('2026-10-13T11:59:00Z', NOW)).toBe(true);
  });

  it('is false for a time that is no time', () => {
    expect(isPastDue('soon', NOW)).toBe(false);
  });
});

describe('the date-time input and the wire', () => {
  it('shows a UTC due time as the phone-local value a datetime-local input takes', () => {
    expect(dueToInput('2026-10-13T17:00:00Z')).toBe('2026-10-13T17:00');
    expect(dueToInput(undefined)).toBe('');
    expect(dueToInput('soon')).toBe('');
  });

  it('turns an input value into the UTC time the todo_edit carries', () => {
    expect(inputToDue('2026-10-13T17:00')).toBe('2026-10-13T17:00:00.000Z');
  });

  it('refuses an empty or half-typed value', () => {
    expect(inputToDue('')).toBeUndefined();
    expect(inputToDue('2026-10-13')).toBeUndefined();
  });
});

describe('Sort by due', () => {
  const card = (id: string, due?: string): TodoCard => ({ id, title: id, priority: 2, created: '', ...(due ? { due } : {}) });

  it('puts the earliest due first and the cards with no due last, in their own order', () => {
    const cards = [card('none-a'), card('late', '2026-10-20T09:00:00Z'), card('none-b'), card('soon', '2026-10-13T17:00:00Z'), card('past', '2026-10-01T09:00:00Z')];
    expect(sortByDue(cards).map((c) => c.id)).toEqual(['past', 'soon', 'late', 'none-a', 'none-b']);
  });

  it('does not change the list it is given', () => {
    const cards = [card('b', '2026-10-20T09:00:00Z'), card('a', '2026-10-13T17:00:00Z')];
    sortByDue(cards);
    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('byDue ties are equal, so the sort keeps the list order', () => {
    expect(byDue(card('a', '2026-10-13T17:00:00Z'), card('b', '2026-10-13T17:00:00Z'))).toBe(0);
  });
});

// mw-ev7oyy.15: the due date as words on the card's face, and when a card is overdue (a day before today, in the phone's zone).
describe('dueWords: the due date as words, no red', () => {
  it('says due today for any time today, even one already gone', () => {
    expect(dueWords('2026-10-13T17:00:00Z', NOW)).toBe('due today');
    expect(dueWords('2026-10-13T08:00:00Z', NOW)).toBe('due today');
  });

  it('says due tomorrow, and the weekday from two to six days ahead', () => {
    expect(dueWords('2026-10-14T09:00:00Z', NOW)).toBe('due tomorrow');
    expect(dueWords('2026-10-15T09:00:00Z', NOW)).toBe('due Thu');
    expect(dueWords('2026-10-19T09:00:00Z', NOW)).toBe('due Mon');
  });

  it('gives the date beyond six days, with the year when it is not this year', () => {
    expect(dueWords('2026-10-20T09:00:00Z', NOW)).toBe('due Oct 20');
    expect(dueWords('2027-01-05T09:00:00Z', NOW)).toBe('due Jan 5 2027');
  });

  it('says overdue since yesterday, the weekday up to six days back, then the date', () => {
    expect(dueWords('2026-10-12T18:30:00Z', NOW)).toBe('overdue since yesterday');
    expect(dueWords('2026-10-11T09:00:00Z', NOW)).toBe('overdue since Sun');
    expect(dueWords('2026-10-07T09:00:00Z', NOW)).toBe('overdue since Wed');
    expect(dueWords('2026-10-06T09:00:00Z', NOW)).toBe('overdue since Oct 6');
  });

  it('reads a time that is no time as nothing', () => {
    expect(dueWords('soon', NOW)).toBe('');
  });
});

describe('isOverdue', () => {
  it('is false all of the due day and true from the day after', () => {
    expect(isOverdue('2026-10-13T08:00:00Z', NOW)).toBe(false);
    expect(isOverdue('2026-10-14T09:00:00Z', NOW)).toBe(false);
    expect(isOverdue('2026-10-12T23:59:00Z', NOW)).toBe(true);
    expect(isOverdue('soon', NOW)).toBe(false);
  });
});
