// src/services/threads.ts — docs/protocol.md §1 and §6: the thread any message's
// decrypted plaintext belongs to. A decision-needed message's own `bead` field
// (its question body, decoded by src/services/questions.ts) already names its
// thread — a reply's `bead` field is the same thread. Every other message's
// plaintext MAY be the `{ thread, text }` shape below instead of bare text; absent
// a `thread` field, or the plaintext isn't this shape at all, it's the general
// thread.
import { decodeQuestion, decodeReply } from './questions';
import { RECORD_PLAINTEXT_MAX_BYTES } from './recordCap';
import { splitText } from '../model/talkLine';
import type { MessageClass } from '../data/db';

export type ThreadRef = { bead: string } | { topic: string };

/** docs/protocol.md §8: a file attached to a message, uploaded encrypted to
 * POST /api/blobs. `size` is the ciphertext's byte length, not the original
 * file's. `name` is the file's base name (e.g. notes.md), absent from older posts. */
export interface Attachment {
  hash: string;
  size: number;
  mime: string;
  name?: string;
}

export interface ThreadedBody {
  thread?: ThreadRef;
  text: string;
  attachment?: Attachment;
  /** docs/protocol.md §8: two or more files sent together as one message, in the
   * order they were added. Never set beside `attachment`: one file is `attachment`. */
  attachments?: Attachment[];
  /** docs/protocol.md §14: the txid of the message this one answers or annotates. */
  re?: string;
  /** docs/protocol.md §14: "transcript" marks the text as what the Mayor's host
   * heard in the voice note `re` names. */
  role?: string;
  /** docs/protocol.md §8, *A message in parts*: one message too long for one record goes as several, each naming the
   * same `split` (the outbox row's client id), its `part` (1-based) and the count, `parts`. Absent on a message of one record. */
  split?: string;
  part?: number;
  parts?: number;
}

function isThreadRef(value: unknown): value is ThreadRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const hasBead = typeof candidate.bead === 'string';
  const hasTopic = typeof candidate.topic === 'string';
  return hasBead !== hasTopic;
}

function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.hash === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.mime === 'string' &&
    (candidate.name === undefined || typeof candidate.name === 'string')
  );
}

function isAttachmentList(value: unknown): value is Attachment[] {
  return Array.isArray(value) && value.length > 0 && value.every(isAttachment);
}

/** Every file a body carries, in order: `attachments` when present, else the one
 * `attachment`, else none. */
export function attachmentsOf(body: Pick<ThreadedBody, 'attachment' | 'attachments'>): Attachment[] {
  if (body.attachments !== undefined) return body.attachments;
  return body.attachment !== undefined ? [body.attachment] : [];
}

/** Encodes a message body that may name a thread and/or carry attachments.
 * Omitting all of them produces the same bare text an unthreaded, attachment-less
 * message already carries, so an old reader (or one that never learns about
 * threads or attachments) sees no format change. One file is always written as
 * `attachment`, exactly as before; `attachments` is written only for two or more. */
export function encodeThreadedMessage(body: ThreadedBody): string {
  const files = attachmentsOf(body);
  // A `re` is only ever read from the JSON shape, so a message that carries one is never bare text.
  if (body.thread === undefined && files.length === 0 && body.re === undefined && body.split === undefined) return body.text;
  return JSON.stringify({
    ...(body.thread !== undefined ? { thread: body.thread } : {}),
    text: body.text,
    ...(files.length === 1 ? { attachment: files[0] } : {}),
    ...(files.length > 1 ? { attachments: files } : {}),
    ...(body.re !== undefined ? { re: body.re } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.split !== undefined ? { split: body.split, part: body.part, parts: body.parts } : {}),
  });
}

/** The bytes `text` takes as UTF-8. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Room kept in a part's own fields for its `part` and `parts` (written with a placeholder of three digits each). */
const PART_PLACEHOLDER = 999;

/**
 * The records a message goes as (docs/protocol.md §8, *A message in parts*): itself when its plaintext fits one record
 * (RECORD_PLAINTEXT_MAX_BYTES), otherwise several naming `split`, in order, none cut: the texts joined are its text.
 * Part 1 carries its files, `re` and `role`; every part carries its thread, so each lands in the same thread. A message
 * whose part 1 has no room for any words (its own fields fill the record) cannot be sent, and throws.
 */
export function messageRecords(body: ThreadedBody, split: string): ThreadedBody[] {
  if (utf8Bytes(encodeThreadedMessage(body)) <= RECORD_PLAINTEXT_MAX_BYTES) return [body];
  const thread = body.thread !== undefined ? { thread: body.thread } : {};
  const room = (fields: ThreadedBody) => RECORD_PLAINTEXT_MAX_BYTES - utf8Bytes(encodeThreadedMessage({ ...fields, text: '', split, part: PART_PLACEHOLDER, parts: PART_PLACEHOLDER }));
  const firstMax = room(body);
  if (firstMax < 1) throw new Error(`This message's files and fields alone are over the ${RECORD_PLAINTEXT_MAX_BYTES}-byte record: send fewer files at once.`);
  const pieces = splitText(body.text, firstMax, room({ ...thread, text: '' }));
  return pieces.map((text, index) => ({ ...(index === 0 ? body : thread), text, split, part: index + 1, parts: pieces.length }));
}

/** The `split`, `part` and `parts` of a plaintext's fields, when all three are well formed (1 <= part <= parts, parts >= 2). */
function readSplit(candidate: Record<string, unknown>): Pick<ThreadedBody, 'split' | 'part' | 'parts'> | undefined {
  const { split, part, parts } = candidate;
  if (typeof split !== 'string' || split === '' || !Number.isInteger(part) || !Number.isInteger(parts)) return undefined;
  if ((parts as number) < 2 || (part as number) < 1 || (part as number) > (parts as number)) return undefined;
  return { split, part: part as number, parts: parts as number };
}

/** Decodes a decrypted plaintext into its thread (if any), attachment or
 * attachments (if any) and text. A message with both fields reads as its
 * `attachments`; one whose `attachments` is empty or holds a malformed entry is
 * plain text. Anything that isn't this JSON shape — plain text, or JSON of some
 * other shape — is the general thread with no attachment, its text unchanged. */
export function decodeThreadedMessage(text: string): ThreadedBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { text };
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.text !== 'string') return { text };
  const hasThread = candidate.thread !== undefined;
  const hasAttachment = candidate.attachment !== undefined;
  const hasAttachments = candidate.attachments !== undefined;
  // docs/protocol.md §14: a transcript on the general thread carries only text,
  // `re` and `role` — still this shape, never plain text.
  const annotates = typeof candidate.re === 'string' || typeof candidate.role === 'string';
  const split = readSplit(candidate);
  if (!hasThread && !hasAttachment && !hasAttachments && !annotates && !split) return { text };
  if (hasThread && !isThreadRef(candidate.thread)) return { text };
  if (hasAttachment && !isAttachment(candidate.attachment)) return { text };
  if (hasAttachments && !isAttachmentList(candidate.attachments)) return { text };
  return {
    text: candidate.text,
    ...(hasThread ? { thread: candidate.thread as ThreadRef } : {}),
    ...(hasAttachments ? { attachments: candidate.attachments as Attachment[] } : hasAttachment ? { attachment: candidate.attachment as Attachment } : {}),
    ...(typeof candidate.re === 'string' ? { re: candidate.re } : {}),
    ...(typeof candidate.role === 'string' ? { role: candidate.role } : {}),
    ...split,
  };
}

/** The thread a decrypted message belongs to, for any class (docs/protocol.md §6):
 * a `decision-needed` message's own `bead` field, or its reply's, IS the thread —
 * neither ever carries a separate `thread` field. Anything else reads the
 * `{ thread, text }` shape above. `undefined` means the general thread. */
export function threadOf(messageClass: MessageClass, plaintext: string | undefined): ThreadRef | undefined {
  if (plaintext === undefined || messageClass === 'talk' || messageClass === 'call' || messageClass === 'card' || messageClass === 'card-update') return undefined;
  if (messageClass === 'decision-needed') {
    const question = decodeQuestion(plaintext);
    return question ? { bead: question.bead } : undefined;
  }
  if (messageClass === 'message') {
    const reply = decodeReply(plaintext);
    if (reply) return { bead: reply.bead };
  }
  return decodeThreadedMessage(plaintext).thread;
}

/** The Dexie `thread` index value for a `ThreadRef` — `undefined` (the general
 * thread) stays `undefined` rather than some sentinel, so a phone's existing
 * messages, stored before this field existed, read as the general thread too. */
export function threadKey(thread: ThreadRef | undefined): string | undefined {
  if (!thread) return undefined;
  return 'bead' in thread ? `bead:${thread.bead}` : `topic:${thread.topic}`;
}

/** The Thread screen's own href for a bead or topic ref — a Discuss control on
 * an epic row (Projects screen) or a story row (Project screen) links straight
 * here with its own bead id. */
export function threadHref(ref: ThreadRef): string {
  return `?screen=thread&thread=${encodeURIComponent(threadKey(ref)!)}`;
}

/** The inverse of `threadKey` — decodes a stored `thread` index value back into
 * its `ThreadRef`, or `undefined` for the general thread. */
export function parseThreadKey(key: string | undefined): ThreadRef | undefined {
  if (!key) return undefined;
  const separator = key.indexOf(':');
  if (separator < 0) return undefined;
  const kind = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (!value) return undefined;
  if (kind === 'bead') return { bead: value };
  if (kind === 'topic') return { topic: value };
  return undefined;
}
