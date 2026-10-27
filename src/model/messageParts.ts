// src/model/messageParts.ts — a message that went in parts (docs/protocol.md §8, *A message in parts*, mw-fjpe9tx) reads
// as one: its records, each kept as its own row, are joined by their `split` into the row of the lowest part here, its
// text the parts' texts in order. A part not here yet is named at the end, so a message is never shown cut without saying so.
import type { MessageRow } from '../data/db';
import { decodeThreadedMessage, encodeThreadedMessage, type ThreadedBody } from '../services/threads';

interface Part {
  row: MessageRow;
  body: ThreadedBody;
}

/** The part a row holds, when it is one: only a message's JSON that names a split is read, so a long list costs a substring test a row. */
function partOf(row: MessageRow): Part | undefined {
  if (row.class !== 'message' || row.plaintext === undefined || !row.plaintext.includes('"split"')) return undefined;
  const body = decodeThreadedMessage(row.plaintext);
  return body.split !== undefined ? { row, body } : undefined;
}

/** The words a missing part leaves in the joined text. */
export function missingPartLine(part: number, parts: number): string {
  return `Missing part ${part} of ${parts}.`;
}

/** One row for the parts of a split: the lowest part's row, its plaintext the message whole (no split fields), read once every part is. */
function joinedRow(parts: Part[]): MessageRow {
  const byPart = new Map<number, Part>();
  for (const part of parts) if (!byPart.has(part.body.part as number)) byPart.set(part.body.part as number, part);
  const count = parts[0].body.parts as number;
  const pieces: string[] = [];
  const missing: string[] = [];
  for (let at = 1; at <= count; at++) {
    const part = byPart.get(at);
    if (part) pieces.push(part.body.text);
    else missing.push(missingPartLine(at, count));
  }
  const lead = byPart.get(Math.min(...byPart.keys())) as Part;
  const text = missing.length ? `${pieces.join('')}\n\n${missing.join('\n')}` : pieces.join('');
  const whole: ThreadedBody = { ...lead.body, text, split: undefined, part: undefined, parts: undefined };
  return { ...lead.row, plaintext: encodeThreadedMessage(whole), read: parts.every((part) => part.row.read) };
}

/** `rows` with every message in parts as one row, where its lowest part stands; every other row as it was, in its place. */
export function joinMessageParts(rows: MessageRow[]): MessageRow[] {
  const splits = new Map<string, Part[]>();
  const parts = rows.map(partOf);
  parts.forEach((part) => {
    if (!part) return;
    const key = `${part.row.from}\u0000${part.body.split}`;
    const group = splits.get(key);
    if (group) group.push(part);
    else splits.set(key, [part]);
  });
  if (splits.size === 0) return rows;
  const out: MessageRow[] = [];
  rows.forEach((row, index) => {
    const part = parts[index];
    if (!part) {
      out.push(row);
      return;
    }
    const group = splits.get(`${row.from}\u0000${part.body.split}`) as Part[];
    const lowest = group.reduce((low, other) => ((other.body.part as number) < (low.body.part as number) ? other : low));
    if (lowest === part) out.push(joinedRow(group));
  });
  return out;
}
