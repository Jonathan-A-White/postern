// tests/unit/todo-calendar.test.ts — mw-ev7oyy.32: a to-do's 'When:' line as two taps, Add to Google Calendar (a
// calendar.google.com TEMPLATE link) and Download .ics (a text/calendar file), both in floating local time.
import { describe, expect, it } from 'vitest';
import { googleCalendarHref, icsHref, icsText, parseWhen } from '../../src/todo';

const LINK = 'https://postern.allmymind.org/?v=bead&id=mw-6ww.114.17';
const NOW = new Date('2026-10-16T14:00:00Z');

function ok(notes: string) {
  const when = parseWhen(notes);
  if (when?.kind !== 'ok') throw new Error(`no When in ${JSON.stringify(notes)}: ${JSON.stringify(when)}`);
  return when;
}

describe('parseWhen', () => {
  it('reads the date and time, and an end thirty minutes on when none is given', () => {
    expect(parseWhen('When: 2026-10-23 07:30')).toEqual({ kind: 'ok', start: '20261023T073000', end: '20261023T080000' });
  });
  it('takes the (his local time) suffix and an explicit end', () => {
    expect(parseWhen('When: 2026-10-23 07:30 (his local time)')).toEqual({ kind: 'ok', start: '20261023T073000', end: '20261023T080000' });
    expect(parseWhen('When: 2026-10-23 07:30-08:15')).toEqual({ kind: 'ok', start: '20261023T073000', end: '20261023T081500' });
    expect(parseWhen('When: 2026-10-23 07:30 - 08:15 (his local time)')).toEqual({ kind: 'ok', start: '20261023T073000', end: '20261023T081500' });
  });
  it('rolls the default end over midnight and a month end', () => {
    expect(parseWhen('When: 2026-10-31 23:45')).toEqual({ kind: 'ok', start: '20261031T234500', end: '20261101T001500' });
  });
  it('finds the line among others, set as a list item or in bold', () => {
    expect(ok('Go.\n\n- **When:** 2026-10-23 07:30\n\nOpen: x').start).toBe('20261023T073000');
  });
  it('is nothing when there is no When: line', () => {
    expect(parseWhen('Blood work. Open: [x](https://example.com)')).toBeUndefined();
    expect(parseWhen('Call him when: it suits')).toBeUndefined();
  });
  it('is bad when the line is there and does not read', () => {
    for (const line of ['When: Friday morning', 'When: 2026-13-45 07:30', 'When: 2026-02-30 07:30', 'When: 2026-10-23 25:00', 'When: 2026-10-23 07:75', 'When: 2026-10-23', 'When: 2026-10-23 07:30-07:00', 'When: 2026-10-23 07:30-08:99']) {
      expect(parseWhen(line), line).toEqual({ kind: 'bad' });
    }
  });
});

describe('googleCalendarHref', () => {
  const href = googleCalendarHref(ok('When: 2026-10-23 07:30'), { title: 'Blood work & labs', id: 'mw-6ww.114.17', link: LINK });
  const url = new URL(href);
  it('is the calendar.google.com TEMPLATE link', () => {
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
  });
  it('escapes the title, spaces and & included', () => {
    expect(href).toContain('text=Blood%20work%20%26%20labs');
    expect(url.searchParams.get('text')).toBe('Blood work & labs');
  });
  it('gives the dates as floating local time, no Z, the end defaulted', () => {
    expect(url.searchParams.get('dates')).toBe('20261023T073000/20261023T080000');
    expect(href).not.toMatch(/dates=[^&]*Z/);
  });
  it('puts the bead id and the Postern link in the details', () => {
    const details = url.searchParams.get('details') ?? '';
    expect(details).toContain('mw-6ww.114.17');
    expect(details).toContain(LINK);
  });
  it('carries an explicit end', () => {
    expect(new URL(googleCalendarHref(ok('When: 2026-10-23 07:30-08:15'), { title: 'x', id: 'a', link: LINK })).searchParams.get('dates')).toBe('20261023T073000/20261023T081500');
  });
});

describe('icsText', () => {
  const text = icsText(ok('When: 2026-10-23 07:30'), { title: 'Blood work', id: 'mw-6ww.114.17', link: LINK, now: NOW });
  const lines = text.split('\r\n');
  it('is a calendar of one event, CRLF lines', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('END:VEVENT');
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('starts and ends in floating local time', () => {
    expect(lines).toContain('DTSTART:20261023T073000');
    expect(lines).toContain('DTEND:20261023T080000');
    expect(lines).toContain('DTSTAMP:20261016T140000Z');
  });
  it('names the title and the bead id', () => {
    expect(lines).toContain('SUMMARY:Blood work');
    expect(lines.find((line) => line.startsWith('DESCRIPTION:'))).toContain('mw-6ww.114.17');
    expect(lines).toContain('UID:mw-6ww.114.17@postern.allmymind.org');
  });
  it('escapes commas, semicolons, backslashes and line breaks in the title', () => {
    const odd = icsText(ok('When: 2026-10-23 07:30'), { title: 'A, B; C\\D\nE', id: 'x', link: LINK, now: NOW });
    expect(odd).toContain('SUMMARY:A\\, B\\; C\\\\D\\nE\r\n');
  });
  it('folds long lines at 75 characters', () => {
    const long = icsText(ok('When: 2026-10-23 07:30'), { title: 'w'.repeat(200), id: 'x', link: LINK, now: NOW });
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, '')).toContain(`SUMMARY:${'w'.repeat(200)}`);
  });
});

describe('icsHref', () => {
  it('is a text/calendar data link that decodes to the file', () => {
    const when = ok('When: 2026-10-23 07:30');
    const href = icsHref(when, { title: 'Blood work', id: 'a', link: LINK, now: NOW });
    expect(href.startsWith('data:text/calendar;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(href.slice(href.indexOf(',') + 1))).toBe(icsText(when, { title: 'Blood work', id: 'a', link: LINK, now: NOW }));
  });
});
