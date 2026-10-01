// src/services/call.ts — call records (docs/protocol.md §21): the plaintext of his Call me
// request, the Mayor's ring and his Later tap, and the delivery of a request as class
// `call`. Like a Talk turn, a call record never joins a channel, an unread count or Needs.
import { deliver, type Delivered, type DeliverOptions } from './deliver';
import { capText } from '../model/talkLine';

/** A request's words are cut at this many bytes (as JSON writes them), ending `...`, so the record stays under the 10,240-byte payload cap. */
export const CALL_TEXT_MAX_BYTES = 2_000;

export type CallRecord =
  | { role: 'request' | 'ring'; text: string; at: number }
  | { role: 'later'; ring_txid: string };

/** The plaintext `ct` seals. A request's text is cut at the cap. */
export function encodeCall(call: CallRecord): string {
  if (call.role === 'later') return JSON.stringify({ role: 'later', ring_txid: call.ring_txid });
  return JSON.stringify({ role: call.role, text: capText(call.text, CALL_TEXT_MAX_BYTES), at: call.at });
}

/** The call record a plaintext holds, or `undefined` for anything that is not one. */
export function decodeCall(plaintext: string | undefined): CallRecord | undefined {
  if (plaintext === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.role === 'later') {
    return typeof candidate.ring_txid === 'string' && candidate.ring_txid !== '' ? { role: 'later', ring_txid: candidate.ring_txid } : undefined;
  }
  if (candidate.role !== 'request' && candidate.role !== 'ring') return undefined;
  if (typeof candidate.text !== 'string' || typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return undefined;
  return { role: candidate.role, text: candidate.text, at: candidate.at };
}

/** Sends his Call me request to the Mayor as class `call`, straight to the backend (§9, §21). `at` is Unix seconds. */
export function deliverCallRequest(text: string, at: number, options: DeliverOptions): Promise<Delivered> {
  return deliver(encodeCall({ role: 'request', text, at }), 'call', options);
}
