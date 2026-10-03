// src/model/shareText.ts — what Share hands the phone (mw-gq6.252): a message or card as the
// plain text he reads, and nothing else. Built from the words on screen only: never a txid, a
// bead id, a file hash, a link target or any other field the screen does not show.
import { markdownToReadable } from '../markdown/readable';
import type { LiveCard } from './cards';
import type { ConversationItem } from './conversation';

/** The title the share sheet shows (a subject line in email): Postern and the channel's name. */
export function shareTitle(channel?: string): string {
  return channel ? `Postern: ${channel}` : 'Postern';
}

/** A message as he reads it; a question card as its question and each option as a line, the recommended one marked. */
export function messageShareText(item: Pick<ConversationItem, 'text' | 'question' | 'transcript'>): string {
  const parts: string[] = [];
  const words = markdownToReadable(item.text);
  if (words) parts.push(words);
  if (item.question) {
    const { rec, options } = item.question;
    parts.push(...options.map((option) => (option === rec ? `${option} (recommended)` : option)));
  }
  if (item.transcript !== undefined && item.transcript !== '') parts.push(`Heard: ${item.transcript}`);
  return parts.join('\n');
}

/** A live card as its title and one numbered line per item, a done one marked. */
export function cardShareText(card: Pick<LiveCard, 'title' | 'items'>): string {
  const lines = card.items.map((item) => `${item.n}. ${markdownToReadable(item.text).replace(/\s*\n\s*/g, ' ')}${item.done ? ' (done)' : ''}`);
  return [markdownToReadable(card.title), ...lines].join('\n');
}
