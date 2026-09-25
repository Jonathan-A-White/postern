// src/services/questions.ts — docs/protocol.md §6 and §7: the structured JSON a
// decision-needed message or its reply carries once decrypted (the envelope itself,
// { v, kind, class, to, from, ts, ct }, is unchanged — see src/services/messages.ts),
// and the Mayor's host snapshot (§7), decrypted the same BRC-78 way and served at
// https://postern.allmymind.org/snapshot.

export interface QuestionBody {
  bead: string;
  q: string;
  rec: string;
  options: string[];
}

export interface ReplyBody {
  bead: string;
  answer: string;
}

export interface SnapshotNeedsYou {
  id: string;
  title: string;
  asked_at: string;
  recommended: string;
  options: string[];
}

export interface SnapshotLanded {
  id: string;
  title: string;
  landed_at: string;
}

export interface SnapshotWorking {
  id: string;
  title: string;
  status: string;
  priority: string;
  updated_at: string;
  waits: string[];
}

export interface SnapshotEpic {
  id: string;
  title: string;
  priority: string;
  status: string;
  needs_you: SnapshotNeedsYou[];
  landed: SnapshotLanded[];
  working: SnapshotWorking[];
  closed_count: number;
}

export interface Snapshot {
  written_at: string;
  epics: SnapshotEpic[];
}

/** Parses `text` as a JSON object carrying a string `bead` field — the shape
 * docs/protocol.md §6 requires of a question or a reply. Anything else (invalid
 * JSON, a non-object, no string `bead`) is plain text, exactly as today. */
function parseStructured(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const candidate = parsed as Record<string, unknown>;
  return typeof candidate.bead === 'string' ? candidate : undefined;
}

/** True if `text` parses as a JSON object with a string `bead` field — the check
 * that distinguishes a question or reply from plain message text. */
export function isStructured(text: string): boolean {
  return parseStructured(text) !== undefined;
}

export function encodeQuestion(body: QuestionBody): string {
  return JSON.stringify(body);
}

/** Decodes a decrypted `decision-needed` plaintext into its question body, or
 * `undefined` if `text` isn't one (an old plain-text message, or malformed JSON). */
export function decodeQuestion(text: string): QuestionBody | undefined {
  const candidate = parseStructured(text);
  if (!candidate) return undefined;
  const { bead, q, rec, options } = candidate;
  if (
    typeof q !== 'string' ||
    typeof rec !== 'string' ||
    !Array.isArray(options) ||
    !options.every((option) => typeof option === 'string')
  ) {
    return undefined;
  }
  return { bead: bead as string, q, rec, options: options as string[] };
}

export function encodeReply(body: ReplyBody): string {
  return JSON.stringify(body);
}

/** Decodes a decrypted reply plaintext into its reply body, or `undefined` if
 * `text` isn't one (an old plain-text message, or malformed JSON). */
export function decodeReply(text: string): ReplyBody | undefined {
  const candidate = parseStructured(text);
  if (!candidate) return undefined;
  const { bead, answer } = candidate;
  if (typeof answer !== 'string') return undefined;
  return { bead: bead as string, answer };
}

/** Decodes a decrypted snapshot plaintext (docs/protocol.md §7) into its typed
 * shape. The snapshot is written only by the Mayor's own host, so this trusts the
 * shape rather than validating it field by field. */
export function decodeSnapshot(plaintext: string): Snapshot {
  return JSON.parse(plaintext) as Snapshot;
}
