// src/model/conversation.ts — one conversation, however it arrived (plans/0021
// decision 10): the Postern messages in a thread and, for a bead's thread, the
// bead's own comments, merged into a single timeline of who said what and when.
// A message's decrypted plaintext is never shown raw: a question reads as its
// question, a reply as the answer given, an action as what was done, a voice note
// as a player with what the Mayor's host heard in it.
import type { MessageRow } from '../data/db';
import { markdownToPlain } from '../markdown/plain';
import { decodeQuestion, decodeReply, type QuestionBody } from '../services/questions';
import { attachmentsOf, decodeThreadedMessage, type Attachment } from '../services/threads';
import type { BeadComment } from './view';

export type Speaker = 'you' | 'mayor' | 'builder' | 'other';

export interface GovernorAction {
  action: 'release' | 'hold' | 'priority' | 'verified' | 'run' | string;
  bead: string;
  priority?: number;
  /** docs/protocol.md §17: the hands step a `run` approves, its hash, when and his signature. */
  step?: string;
  sha256?: string;
  approved_at?: number;
  sig?: string;
}

export type ItemKind = 'text' | 'question' | 'answer' | 'action' | 'attachment' | 'comment';

export interface ConversationItem {
  id: string;
  /** Milliseconds since the epoch. */
  at: number;
  speaker: Speaker;
  speakerLabel: string;
  kind: ItemKind;
  text: string;
  question?: QuestionBody;
  answer?: string;
  action?: GovernorAction;
  /** The files this message carries, in order: one or more, on an 'attachment' item. */
  attachments?: Attachment[];
  /** What the Mayor's host heard in this voice note (docs/protocol.md §14). */
  transcript?: string;
  txid?: string;
  /** The txid this message answers or annotates (its record's `re`), when it names one. */
  re?: string;
  unread?: boolean;
  pending?: boolean;
  failed?: boolean;
  source: 'message' | 'comment';
}

export function decodeAction(text: string): GovernorAction | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.action !== 'string' || typeof candidate.bead !== 'string') return undefined;
  return {
    action: candidate.action,
    bead: candidate.bead,
    ...(typeof candidate.priority === 'number' ? { priority: candidate.priority } : {}),
    ...(typeof candidate.step === 'string' ? { step: candidate.step } : {}),
  };
}

/** What a move-home message (class `move-home`, plaintext {"host": …}) reads as. */
function describeMoveHome(text: string): string {
  try {
    const host = (JSON.parse(text) as { host?: unknown }).host;
    if (typeof host === 'string') return `Asked to move the factory's home to ${host}`;
  } catch {
    // not the shape; fall through
  }
  return "Asked to move the factory's home";
}

export function describeAction(action: GovernorAction): string {
  switch (action.action) {
    case 'release':
      return `Released ${action.bead}`;
    case 'hold':
      return `Held ${action.bead}`;
    case 'priority':
      return `Set ${action.bead} to P${action.priority ?? '?'}`;
    case 'verified':
      return `Marked ${action.bead} verified`;
    case 'keep':
      return `Kept ${action.bead}`;
    case 'close':
      return `Closed ${action.bead}`;
    case 'run':
      return `Approved step ${action.step ?? '?'} of ${action.bead} to run`;
    default:
      return `${action.action} ${action.bead}`;
  }
}

/** The one-line, human reading of a message's plaintext — for list previews,
 * notifications and read-aloud. Never JSON, and its Markdown as plain text. */
export function previewText(row: Pick<MessageRow, 'plaintext' | 'class' | 'decryptFailed'>): string {
  if (row.plaintext === undefined) return row.decryptFailed ? 'Could not be decrypted' : 'Locked — unlock to read';
  const text = row.plaintext;
  if (row.class === 'move-home') return describeMoveHome(text);
  if (row.class === 'decision-needed') {
    const question = decodeQuestion(text);
    if (question) return markdownToPlain(question.q);
  }
  const action = decodeAction(text);
  if (action) return describeAction(action);
  const reply = decodeReply(text);
  if (reply) return `Answered: ${reply.answer}`;
  const body = decodeThreadedMessage(text);
  const files = attachmentsOf(body);
  if (files.length > 0) {
    const label = attachmentsLabel(files);
    const plain = markdownToPlain(body.text);
    return plain ? `${label} · ${plain}` : label;
  }
  return markdownToPlain(body.text);
}

export function attachmentLabel(attachment: Attachment): string {
  if (attachment.mime.startsWith('audio/')) return 'Voice note';
  if (attachment.mime.startsWith('image/')) return 'Image';
  if (attachment.mime === 'application/pdf') return 'PDF';
  return 'File';
}

/** What several files read as in a preview: one as its own label, two or more
 * images '2 images', any other mix '3 files'. */
export function attachmentsLabel(files: Attachment[]): string {
  if (files.length === 1) return attachmentLabel(files[0]);
  return files.every((file) => file.mime.startsWith('image/')) ? `${files.length} images` : `${files.length} files`;
}

function speakerOfMessage(row: MessageRow): { speaker: Speaker; label: string } {
  return row.direction === 'sent' ? { speaker: 'you', label: 'You' } : { speaker: 'mayor', label: 'Mayor' };
}

/** A decrypted message row as a conversation item; a transcript is returned as
 * its own item with `transcriptOf` set, for mergeConversation to fold into the
 * voice note it belongs to. */
export function itemFromMessage(row: MessageRow): ConversationItem & { transcriptOf?: string } {
  const { speaker, label } = speakerOfMessage(row);
  const base = {
    id: row.id,
    at: row.ts * 1000,
    speaker,
    speakerLabel: label,
    txid: row.txid,
    unread: row.direction === 'received' && !row.read,
    source: 'message' as const,
  };
  if (row.plaintext === undefined) {
    return { ...base, kind: 'text', text: row.decryptFailed ? 'This message could not be decrypted with this key.' : 'Locked — unlock to read this message.' };
  }
  const text = row.plaintext;
  if (row.class === 'move-home') return { ...base, kind: 'text', text: describeMoveHome(text) };
  if (row.class === 'decision-needed') {
    const question = decodeQuestion(text);
    if (question) return { ...base, kind: 'question', text: question.q, question };
  }
  const action = decodeAction(text);
  if (action) return { ...base, kind: 'action', text: describeAction(action), action };
  const reply = decodeReply(text);
  if (reply) return { ...base, kind: 'answer', text: reply.answer, answer: reply.answer };
  const body = decodeThreadedMessage(text);
  if (body.role === 'transcript' && body.re) {
    return { ...base, kind: 'text', text: body.text, transcriptOf: body.re };
  }
  const files = attachmentsOf(body);
  if (files.length > 0) return { ...base, kind: 'attachment', text: body.text, attachments: files };
  return { ...base, kind: 'text', text: body.text, ...(body.re !== undefined ? { re: body.re } : {}) };
}

const TXID_IN_TEXT = /\b(?:txid|tx)\s+((?:direct:)?[0-9a-f]{64})/gi;

function txidsIn(text: string): string[] {
  return [...text.matchAll(TXID_IN_TEXT)].map((match) => match[1].toLowerCase());
}

// `mw postern inbox` records the Governor's message on the bead it names as
// 'The Governor by postern <RFC3339 ts>: <text>', ending ' [image: <desktop path>]'
// (or audio / file) for an attachment. It names no txid; the message's own ts is
// the only thing it shares with the message.
const GOVERNOR_BY_POSTERN = /^The Governor by postern (\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)): ?([\s\S]*)$/;
const DESKTOP_ATTACHMENT_TAG = /\s*\[(image|audio|file): [^\]]*\]\s*$/;

interface RecordedMessage {
  /** Seconds since the epoch: the message's own `ts`. */
  ts: number;
  text: string;
}

function recordedMessage(comment: string): RecordedMessage | undefined {
  const match = GOVERNOR_BY_POSTERN.exec(comment);
  if (!match) return undefined;
  const ms = Date.parse(match[1]);
  if (Number.isNaN(ms)) return undefined;
  const tag = DESKTOP_ATTACHMENT_TAG.exec(match[2]);
  const text = match[2].replace(DESKTOP_ATTACHMENT_TAG, '');
  return { ts: Math.floor(ms / 1000), text: tag ? `${text} (${tag[1]})`.trim() : text };
}

export function speakerOfComment(author: string): { speaker: Speaker; label: string } {
  const who = author.trim().toLowerCase();
  if (who === 'root' || who === 'mayor' || who.startsWith('mayor@')) return { speaker: 'mayor', label: 'Mayor' };
  if (who.startsWith('mw@') || who.startsWith('builder')) return { speaker: 'builder', label: `Builder${who.includes('@') ? ` · ${who.split('@')[1]}` : ''}` };
  if (who === 'governor' || who === 'jwhite' || who === 'jonathan') return { speaker: 'you', label: 'You' };
  return { speaker: 'other', label: author || 'Someone' };
}

/** A bead's comments and its thread's messages, oldest first. A comment the
 * Mayor's host wrote to record one of these very messages (it names the
 * message's txid), or that says a run the thread's message says (the message is
 * "re" a txid the comment names: the approval), is left out, so nothing is said
 * twice; a transcript is folded into the voice note it transcribes. */
export function mergeConversation(rows: MessageRow[], comments: BeadComment[] = []): ConversationItem[] {
  const decoded = rows.map(itemFromMessage);
  const transcripts = new Map<string, string>();
  const items: ConversationItem[] = [];
  for (const item of decoded) {
    if (item.transcriptOf) {
      transcripts.set(item.transcriptOf.toLowerCase(), item.text);
      continue;
    }
    items.push(item);
  }
  for (const item of items) {
    const transcript = item.txid ? transcripts.get(item.txid.toLowerCase()) : undefined;
    if (transcript !== undefined) item.transcript = transcript;
  }

  const known = new Set(rows.map((row) => row.txid.toLowerCase()));
  const sentAt = new Set(rows.map((row) => row.ts));
  const answered = new Set(items.flatMap((item) => (item.re ? [item.re.toLowerCase()] : [])));
  comments.forEach((comment, index) => {
    const named = txidsIn(comment.text);
    if (named.some((txid) => known.has(txid) || answered.has(txid))) return;
    // His message recorded by the hook: shown once, as the message itself (its
    // picture, not the desktop path); if the message is not here, as his words.
    const recorded = recordedMessage(comment.text);
    if (recorded && sentAt.has(recorded.ts)) return;
    const { speaker, label } = recorded ? { speaker: 'you' as const, label: 'You' } : speakerOfComment(comment.author);
    const at = Date.parse(comment.at);
    items.push({
      id: `comment:${index}:${comment.at}`,
      at: Number.isNaN(at) ? 0 : at,
      speaker,
      speakerLabel: label,
      kind: 'comment',
      text: recorded ? recorded.text : comment.text,
      source: 'comment',
    });
  });

  return items.sort((a, b) => a.at - b.at);
}
