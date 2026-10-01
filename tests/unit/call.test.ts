// The call record's plaintext (docs/protocol.md §21): his Call me request, the Mayor's
// ring and his Later tap, and which of them is still waiting for an answer.
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { CALL_TEXT_MAX_BYTES, decodeCall, encodeCall } from '../../src/services/call';
import { callSent, callSentAt, clockHHMM } from '../../src/model/call';

function row(over: Partial<MessageRow>): MessageRow {
  return {
    id: 'x:0',
    txid: 'x',
    vout: 0,
    seq: 1,
    class: 'call',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1000,
    ciphertext: '',
    plaintext: '',
    direction: 'sent',
    read: true,
    ...over,
  };
}

describe('the call plaintext', () => {
  it('a request carries the role, the words and the time in seconds', () => {
    const plaintext = encodeCall({ role: 'request', text: 'Call me', at: 1_790_000_000 });
    expect(JSON.parse(plaintext)).toEqual({ role: 'request', text: 'Call me', at: 1_790_000_000 });
    expect(decodeCall(plaintext)).toEqual({ role: 'request', text: 'Call me', at: 1_790_000_000 });
  });

  it('a ring round-trips, and a later names the ring it puts off', () => {
    const ring = { role: 'ring' as const, text: 'Back now.', at: 5 };
    expect(decodeCall(encodeCall(ring))).toEqual(ring);
    const later = { role: 'later' as const, ring_txid: `direct:${'a'.repeat(64)}` };
    expect(JSON.parse(encodeCall(later))).toEqual(later);
    expect(decodeCall(encodeCall(later))).toEqual(later);
  });

  it('a request longer than the cap is cut and ends with ...', () => {
    const plaintext = encodeCall({ role: 'request', text: 'w'.repeat(CALL_TEXT_MAX_BYTES * 2), at: 1 });
    const { text } = JSON.parse(plaintext) as { text: string };
    expect(text.endsWith('...')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(CALL_TEXT_MAX_BYTES);
  });

  it('anything that is not a call decodes to nothing', () => {
    for (const bad of [undefined, 'Call me', '{"text":"hi"}', '{"role":"shout","text":"x","at":1}', '{"role":"request","at":1}', '{"role":"request","text":"x"}', '{"role":"later"}', '[]']) {
      expect(decodeCall(bad)).toBeUndefined();
    }
  });
});

describe('the time the screen shows', () => {
  it('reads as HH:MM, two digits each', () => {
    expect(clockHHMM(Date.UTC(2026, 9, 1, 4, 5) / 1000)).toBe('04:05');
    expect(clockHHMM(Date.UTC(2026, 9, 1, 23, 59) / 1000)).toBe('23:59');
  });
});

describe('Call sent waits until the Mayor answers', () => {
  const request = row({ id: 'r:0', txid: 'r', ts: 1000, plaintext: encodeCall({ role: 'request', text: 'Call me', at: 1000 }) });

  it('is the newest request while nothing has come back after it', () => {
    expect(callSentAt([request])).toBe(1000);
    expect(callSentAt([])).toBeUndefined();
  });

  it('goes when a ring or a talk answer from the Mayor arrives after it', () => {
    const ring = row({ id: 'g:0', txid: 'g', class: 'call', direction: 'received', ts: 1001, plaintext: encodeCall({ role: 'ring', text: 'Hi', at: 1001 }) });
    const answer = row({ id: 'a:0', txid: 'a', class: 'talk', direction: 'received', ts: 1002, plaintext: '{}' });
    expect(callSentAt([request, ring])).toBeUndefined();
    expect(callSentAt([request, answer])).toBeUndefined();
  });

  it('stays while what came back is older, or is his own', () => {
    const old = row({ id: 'o:0', txid: 'o', class: 'talk', direction: 'received', ts: 999, plaintext: '{}' });
    const own = row({ id: 'm:0', txid: 'm', class: 'talk', direction: 'sent', ts: 1005, plaintext: '{}' });
    expect(callSentAt([old, request, own])).toBe(1000);
  });

  it('a later request after an answered one waits again', () => {
    const ring = row({ id: 'g:0', txid: 'g', direction: 'received', ts: 1001, plaintext: encodeCall({ role: 'ring', text: 'Hi', at: 1001 }) });
    const again = row({ id: 'r2:0', txid: 'r2', ts: 2000, plaintext: encodeCall({ role: 'request', text: 'Call me', at: 2000 }) });
    expect(callSentAt([request, ring, again])).toBe(2000);
  });
});

describe('how the waiting request went', () => {
  const plaintext = encodeCall({ role: 'request', text: 'Call me', at: 1000 });

  it('says its time and txid, and a direct id is not on chain', () => {
    const direct = row({ id: `direct:${'e'.repeat(64)}:0`, txid: `direct:${'e'.repeat(64)}`, plaintext });
    expect(callSent([direct])).toEqual({ at: 1000, txid: direct.txid, onChain: false });
    const chain = row({ id: `${'f'.repeat(64)}:0`, txid: 'f'.repeat(64), plaintext });
    expect(callSent([chain])).toEqual({ at: 1000, txid: 'f'.repeat(64), onChain: true });
  });

  it('is nothing once the Mayor has answered', () => {
    const ring = row({ id: 'g:0', txid: 'g', direction: 'received', ts: 1001, plaintext: encodeCall({ role: 'ring', text: 'Hi', at: 1001 }) });
    expect(callSent([row({ plaintext }), ring])).toBeUndefined();
  });
});
