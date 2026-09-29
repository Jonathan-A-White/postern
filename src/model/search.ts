// src/model/search.ts — one search box over everything the phone holds (plans/0021
// decision 13): the live view's beads, the full details fetched so far
// (descriptions, acceptance, every comment), and every decrypted message. Ranked
// so an exact id or a title hit comes before a word buried in a comment.
import type { MessageRow } from '../data/db';
import { previewText } from './conversation';
import { tokens } from './filter';
import type { BeadDetail, ViewBead } from './view';

export type SearchHitKind = 'bead' | 'comment' | 'message';

export interface SearchHit {
  kind: SearchHitKind;
  score: number;
  /** The bead the hit belongs to, when it belongs to one. */
  bead?: string;
  title: string;
  snippet: string;
  at?: string;
  /** For a message: its thread key (docs/protocol.md §6) and id. */
  thread?: string;
  messageId?: string;
}

function snippetAround(text: string, words: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const first = words.map((word) => lower.indexOf(word)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - radius);
  const end = Math.min(flat.length, first + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

function containsAll(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

export interface SearchInput {
  beads: ViewBead[];
  details: BeadDetail[];
  messages: MessageRow[];
}

/** The bead id a query is nothing but (mw-xxxx or mw-xxxx.N), lower-cased, with
 * surrounding spaces and a trailing '-' dropped; null for any other query. */
export function beadIdQuery(query: string): string | null {
  const id = query.trim().toLowerCase().replace(/[\s-]+$/, '');
  return /^mw-[a-z0-9]+(?:\.\d+)*$/.test(id) ? id : null;
}

export function search(query: string, input: SearchInput, limit = 60): SearchHit[] {
  const id = beadIdQuery(query);
  const words = id ? [id] : tokens(query);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  const titles = new Map(input.beads.map((bead) => [bead.id, bead.title]));

  for (const bead of input.beads) {
    const id = bead.id.toLowerCase();
    const title = bead.title.toLowerCase();
    const all = [bead.id, bead.title, bead.summary, bead.labels.join(' '), ...(bead.path ? Object.values(bead.path) : [])].join(' ');
    if (!containsAll(all, words)) continue;
    let score = 10;
    if (words.length === 1 && id === words[0]) score += 100;
    if (words.every((word) => title.includes(word))) score += 40;
    if (words.some((word) => id.startsWith(word))) score += 15;
    if (bead.status !== 'closed') score += 5;
    hits.push({ kind: 'bead', score, bead: bead.id, title: bead.title, snippet: bead.summary || bead.id, at: bead.updated });
  }

  for (const detail of input.details) {
    const title = titles.get(detail.id) ?? detail.title;
    for (const [field, text] of [
      ['description', detail.description],
      ['acceptance', detail.acceptance],
    ] as const) {
      if (text && containsAll(text, words)) {
        hits.push({ kind: 'comment', score: 6, bead: detail.id, title: `${title} — ${field}`, snippet: snippetAround(text, words), at: detail.updated });
      }
    }
    for (const comment of detail.comments) {
      if (!containsAll(comment.text, words)) continue;
      hits.push({ kind: 'comment', score: 5, bead: detail.id, title, snippet: snippetAround(comment.text, words), at: comment.at });
    }
  }

  for (const row of input.messages) {
    const text = previewText(row);
    if (!row.plaintext || !containsAll(text, words)) continue;
    const bead = row.thread?.startsWith('bead:') ? row.thread.slice(5) : undefined;
    hits.push({
      kind: 'message',
      score: 7,
      bead,
      title: bead ? titles.get(bead) ?? bead : row.thread?.startsWith('topic:') ? row.thread.slice(6) : 'Factory',
      snippet: snippetAround(text, words),
      at: new Date(row.ts * 1000).toISOString(),
      thread: row.thread,
      messageId: row.id,
    });
  }

  return hits.sort((a, b) => b.score - a.score || (b.at ?? '').localeCompare(a.at ?? '')).slice(0, limit);
}
