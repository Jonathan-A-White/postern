// src/services/threads.ts — docs/protocol.md §1 and §6: the thread any message's
// decrypted plaintext belongs to. A decision-needed message's own `bead` field
// (its question body, decoded by src/services/questions.ts) already names its
// thread — a reply's `bead` field is the same thread. Every other message's
// plaintext MAY be the `{ thread, text }` shape below instead of bare text; absent
// a `thread` field, or the plaintext isn't this shape at all, it's the general
// thread.
import { decodeQuestion, decodeReply } from './questions';
import type { MessageClass } from '../data/db';

export type ThreadRef = { bead: string } | { topic: string };

/** docs/protocol.md §8: an image attached to a message, uploaded encrypted to
 * POST /api/blobs. `size` is the ciphertext's byte length, not the original
 * image's. */
export interface Attachment {
  hash: string;
  size: number;
  mime: string;
}

export interface ThreadedBody {
  thread?: ThreadRef;
  text: string;
  attachment?: Attachment;
  /** docs/protocol.md §14: the txid of the message this one answers or annotates. */
  re?: string;
  /** docs/protocol.md §14: "transcript" marks the text as what the Mayor's host
   * heard in the voice note `re` names. */
  role?: string;
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
  return typeof candidate.hash === 'string' && typeof candidate.size === 'number' && typeof candidate.mime === 'string';
}

/** Encodes a message body that may name a thread and/or carry an attachment.
 * Omitting both produces the same bare text an unthreaded, attachment-less
 * message already carries, so an old reader (or one that never learns about
 * threads or attachments) sees no format change. */
export function encodeThreadedMessage(body: ThreadedBody): string {
  if (body.thread === undefined && body.attachment === undefined) return body.text;
  return JSON.stringify({
    ...(body.thread !== undefined ? { thread: body.thread } : {}),
    text: body.text,
    ...(body.attachment !== undefined ? { attachment: body.attachment } : {}),
    ...(body.re !== undefined ? { re: body.re } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
  });
}

/** Decodes a decrypted plaintext into its thread (if any), attachment (if any)
 * and text. Anything that isn't this JSON shape — plain text, or JSON of some
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
  // docs/protocol.md §14: a transcript on the general thread carries only text,
  // `re` and `role` — still this shape, never plain text.
  const annotates = typeof candidate.re === 'string' || typeof candidate.role === 'string';
  if (!hasThread && !hasAttachment && !annotates) return { text };
  if (hasThread && !isThreadRef(candidate.thread)) return { text };
  if (hasAttachment && !isAttachment(candidate.attachment)) return { text };
  return {
    text: candidate.text,
    ...(hasThread ? { thread: candidate.thread as ThreadRef } : {}),
    ...(hasAttachment ? { attachment: candidate.attachment as Attachment } : {}),
    ...(typeof candidate.re === 'string' ? { re: candidate.re } : {}),
    ...(typeof candidate.role === 'string' ? { role: candidate.role } : {}),
  };
}

/** The thread a decrypted message belongs to, for any class (docs/protocol.md §6):
 * a `decision-needed` message's own `bead` field, or its reply's, IS the thread —
 * neither ever carries a separate `thread` field. Anything else reads the
 * `{ thread, text }` shape above. `undefined` means the general thread. */
export function threadOf(messageClass: MessageClass, plaintext: string | undefined): ThreadRef | undefined {
  if (plaintext === undefined) return undefined;
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
