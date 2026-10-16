// src/todo/calendar.ts — a To do card's calendar entry (mw-ev7oyy.32): the 'When:' line of its notes, 'When: YYYY-MM-DD HH:MM'
// (an optional '(his local time)' after it, an optional end '-HH:MM'), as two taps: Add to Google Calendar, a calendar.google.com
// TEMPLATE link (no sign-in, no keys), and Download .ics, a text/calendar file any calendar app opens. Both give floating local
// time (no Z, no zone): the entry lands at that wall-clock time in the phone's own calendar. With no end the entry runs 30 minutes.
// Pure: no React. parseWhen says whether the line is there and whether it reads; the two builders only take what it found.

/** What a card's 'When:' line made: a start and end as floating local time (YYYYMMDDTHHMMSS), or a line that did not read. */
export type When = { kind: 'ok'; start: string; end: string } | { kind: 'bad' };

/** What an entry is called, and the words that tell him where it came from. */
export interface CalendarEntry {
  title: string;
  /** The card's bead id. */
  id: string;
  /** The card in Postern, as an absolute link. */
  link: string;
}

/** The entry's length when the line gives no end. */
const DEFAULT_MINUTES = 30;

/** A line that opens with 'When:' (as a list item, a quote or in bold, too) and what follows it. */
const WHEN_LINE = /^[\s>*+-]*(?:\*\*|__)?When:(?:\*\*|__)?(.*)$/;
/** The date, the time, and the optional end; the parenthesis after them is taken out first. */
const WHEN_BODY = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?:\s*[-–—]\s*(\d{2}):(\d{2}))?\s*$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Minutes since the epoch of a wall-clock time read as if it were UTC (so a zone never shifts it), or undefined when no such moment exists. */
function wallMinutes(y: number, mo: number, d: number, h: number, mi: number): number | undefined {
  if (h > 23 || mi > 59 || mo < 1 || mo > 12) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms / 60_000 : undefined;
}

function floating(minutes: number): string {
  const at = new Date(minutes * 60_000);
  return `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00`;
}

/** The first 'When:' line of a description, read. Undefined when there is no such line; { kind: 'bad' } when there is one and it holds no real
 * date and time, or its end is not after its start (the card then shows neither tap, and says so). */
export function parseWhen(description: string): When | undefined {
  const rest = description.split(/\r?\n/).map((line) => WHEN_LINE.exec(line)?.[1]).find((found) => found !== undefined);
  if (rest === undefined) return undefined;
  const parts = WHEN_BODY.exec(rest.replace(/\([^)]*\)/g, ' '));
  if (!parts) return { kind: 'bad' };
  const [y, mo, d, h, mi] = parts.slice(1, 6).map(Number);
  const start = wallMinutes(y, mo, d, h, mi);
  if (start === undefined) return { kind: 'bad' };
  let end = start + DEFAULT_MINUTES;
  if (parts[6] !== undefined) {
    const explicit = wallMinutes(y, mo, d, Number(parts[6]), Number(parts[7]));
    if (explicit === undefined || explicit <= start) return { kind: 'bad' };
    end = explicit;
  }
  return { kind: 'ok', start: floating(start), end: floating(end) };
}

const detailsOf = ({ id, link }: CalendarEntry) => `${id}\n${link}`;

/** The Add to Google Calendar link: calendar.google.com/calendar/render?action=TEMPLATE, the title as text, the dates floating local time,
 * the details the bead id and the card's Postern link. Every field is percent-encoded whole (a space, '&', '#', an emoji). */
export function googleCalendarHref(when: Extract<When, { kind: 'ok' }>, entry: CalendarEntry): string {
  const field = (value: string) => encodeURIComponent(value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'));
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${field(entry.title)}&dates=${when.start}/${when.end}&details=${field(detailsOf(entry))}`;
}

const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A content line folded at 75 octets as RFC 5545 asks: each continuation starts with a space, and a character is never split. */
function fold(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (octets + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.map((part, at) => (at ? ` ${part}` : part));
}

/** The .ics file: one VEVENT with DTSTART and DTEND in floating local time, the title as SUMMARY, the bead id and the card's link as DESCRIPTION.
 * `now` stamps it (DTSTAMP, UTC); a test passes one. */
export function icsText(when: Extract<When, { kind: 'ok' }>, entry: CalendarEntry & { now?: Date }): string {
  const stamp = (entry.now ?? new Date()).toISOString().replace(/[-:]|\.\d+/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Postern//To do//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${entry.id}@postern.allmymind.org`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${when.start}`,
    `DTEND:${when.end}`,
    `SUMMARY:${escapeText(entry.title)}`,
    `DESCRIPTION:${escapeText(detailsOf(entry))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

/** The Download .ics link: the file as a data: link, to be given a download name, so a tap saves it and the phone opens it in its calendar. */
export function icsHref(when: Extract<When, { kind: 'ok' }>, entry: CalendarEntry & { now?: Date }): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsText(when, entry))}`;
}
