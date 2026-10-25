// src/services/talk.ts — Talk line turns (docs/protocol.md §20): the plaintext of a
// turn, and its delivery as class `talk`. A turn is its own record: it never joins
// a channel, an unread count or Needs, and the backend never pushes it.
import { deliver, type Delivered, type DeliverOptions } from './deliver';
import { attachmentsOf, type Attachment } from './threads';
import { ABOUT_KINDS, type TalkAbout, type TalkRole, type TalkTurn } from '../model/talkLine';

export type { TalkRole, TalkTurn };

const ROLES: TalkRole[] = ['turn', 'answer', 'holding', 'end'];

/** The plaintext `ct` seals: optional fields are left out rather than written empty. */
export function encodeTurn(turn: TalkTurn): string {
  return JSON.stringify({
    talk: { id: turn.talk.id, turn: turn.talk.turn },
    text: turn.text,
    role: turn.role,
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.cut ? { cut: true } : {}),
    ...(turn.links?.length ? { links: turn.links } : {}),
    ...(turn.about ? { about: { kind: turn.about.kind, id: turn.about.id, title: turn.about.title } } : {}),
    ...writeAttachments(turn),
    ...(turn.parts !== undefined && turn.parts > 1 && turn.part !== undefined ? { part: turn.part, parts: turn.parts } : {}),
  });
}

/** An attachment as §8 writes it: exactly {hash, size, mime, name?}, whatever else the object holds. */
function writeAttachment(attachment: Attachment): Attachment {
  return { hash: attachment.hash, size: attachment.size, mime: attachment.mime, ...(attachment.name !== undefined ? { name: attachment.name } : {}) };
}

/** A turn's files as §8 writes a message's: one as `attachment`, two or more as `attachments` in the order chosen. */
function writeAttachments(turn: TalkTurn): { attachment?: Attachment; attachments?: Attachment[] } {
  const files = attachmentsOf(turn).map(writeAttachment);
  if (files.length === 0) return {};
  return files.length === 1 ? { attachment: files[0] } : { attachments: files };
}

/** The attachment a turn carries, or `undefined` when it holds none or a malformed one. */
export function readAttachment(value: unknown): Attachment | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { hash, size, mime, name } = value as Record<string, unknown>;
  if (typeof hash !== 'string' || hash === '' || typeof size !== 'number' || !Number.isFinite(size) || typeof mime !== 'string' || mime === '') return undefined;
  return writeAttachment({ hash, size, mime, ...(typeof name === 'string' && name !== '' ? { name } : {}) });
}

/** The files a plaintext carries: `attachments` when it holds two or more and all are well formed, else its one `attachment`; a turn with a malformed file in its list carries none of the list. */
function readAttachments(candidate: Record<string, unknown>): { attachment?: Attachment; attachments?: Attachment[] } {
  const { attachments } = candidate;
  if (Array.isArray(attachments)) {
    const files = attachments.map(readAttachment);
    if (files.length > 0 && files.every((file): file is Attachment => file !== undefined)) return files.length === 1 ? { attachment: files[0] } : { attachments: files };
    return {};
  }
  const one = readAttachment(candidate.attachment);
  return one ? { attachment: one } : {};
}

/** An `about` with all three keys and a known kind; anything else is no about. */
export function readAbout(value: unknown): TalkAbout | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { kind, id, title } = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !ABOUT_KINDS.includes(kind as TalkAbout['kind'])) return undefined;
  if (typeof id !== 'string' || id === '' || typeof title !== 'string') return undefined;
  return { kind: kind as TalkAbout['kind'], id, title };
}

/** The turn a plaintext holds, or `undefined` for anything that is not one. */
export function decodeTurn(plaintext: string | undefined): TalkTurn | undefined {
  if (plaintext === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  const talk = candidate.talk as { id?: unknown; turn?: unknown } | null | undefined;
  if (typeof talk !== 'object' || talk === null) return undefined;
  if (typeof talk.id !== 'string' || talk.id === '' || typeof talk.turn !== 'number' || !Number.isInteger(talk.turn)) return undefined;
  if (typeof candidate.text !== 'string') return undefined;
  if (typeof candidate.role !== 'string' || !ROLES.includes(candidate.role as TalkRole)) return undefined;
  const { part, parts } = candidate;
  const partOf = typeof part === 'number' && typeof parts === 'number' && Number.isInteger(part) && Number.isInteger(parts) && parts > 1 && part >= 1 && part <= parts;
  const links = Array.isArray(candidate.links) ? candidate.links.filter((id): id is string => typeof id === 'string' && id !== '') : [];
  return {
    talk: { id: talk.id, turn: talk.turn },
    text: candidate.text,
    role: candidate.role as TalkRole,
    ...(typeof candidate.model === 'string' && candidate.model ? { model: candidate.model } : {}),
    ...(candidate.cut === true ? { cut: true } : {}),
    ...(links.length ? { links } : {}),
    ...(readAbout(candidate.about) ? { about: readAbout(candidate.about) } : {}),
    ...readAttachments(candidate),
    ...(partOf ? { part, parts } : {}),
  };
}

/** Sends his turn to the Mayor as class `talk`, straight to the backend (§9, §20). */
export function deliverTurn(turn: TalkTurn, options: DeliverOptions): Promise<Delivered> {
  return deliver(encodeTurn(turn), 'talk', options);
}

/** A fresh id for a new talk. */
export function newTalkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
