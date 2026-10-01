// src/services/talk.ts — Talk line turns (docs/protocol.md §20): the plaintext of a
// turn, and its delivery as class `talk`. A turn is its own record: it never joins
// a channel, an unread count or Needs, and the backend never pushes it.
import { deliver, type Delivered, type DeliverOptions } from './deliver';
import type { TalkRole, TalkTurn } from '../model/talkLine';

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
  });
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
  return {
    talk: { id: talk.id, turn: talk.turn },
    text: candidate.text,
    role: candidate.role as TalkRole,
    ...(typeof candidate.model === 'string' && candidate.model ? { model: candidate.model } : {}),
    ...(candidate.cut === true ? { cut: true } : {}),
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
