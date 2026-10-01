// A long hold must always send (mw-j0f2d.15). The cause of the old 'Could not send' was
// the record's size limit: spell-forge-bsv's encodeRecordScript throws when a record's payload
// (the envelope with the base64 ciphertext) passes 10,240 bytes, which is about 7,250 bytes of
// the turn's JSON. So a turn is cut at TURN_TEXT_MAX_BYTES with '...', and still goes.
import { describe, it, expect, vi } from 'vitest';
import { PrivateKey, Script, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { deliverTurn, decodeTurn } from '../../src/services/talk';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import { capTurnText, TURN_TEXT_MAX_BYTES, type TalkTurn } from '../../src/model/talkLine';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const RECORD_PAYLOAD_LIMIT = 10 * 1024;
const GOV = PrivateKey.fromRandom();
const MAYOR = PrivateKey.fromRandom();
/** The bytes the text takes inside the turn's JSON plaintext (escapes count). */
const bytes = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length - 2;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 97}`).join(' ');

describe('capTurnText', () => {
  it('leaves a turn that fits exactly as it was said', () => {
    const text = words(900);
    expect(bytes(text)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    expect(capTurnText(text)).toBe(text);
  });

  it('cuts a ~2,000-word turn at the cap and ends it with "..."', () => {
    const text = words(2000);
    const capped = capTurnText(text);
    expect(capped.endsWith('...')).toBe(true);
    expect(bytes(capped)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    expect(text.startsWith(capped.slice(0, -3))).toBe(true);
    expect(capped.split(' ').length).toBeGreaterThan(900);
  });

  it('counts bytes as the JSON carries them, and never splits a character', () => {
    const capped = capTurnText('é'.repeat(TURN_TEXT_MAX_BYTES) + '😀'.repeat(10));
    expect(bytes(capped)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    expect(capped.endsWith('...')).toBe(true);
    const emoji = capTurnText('😀'.repeat(TURN_TEXT_MAX_BYTES));
    expect(bytes(emoji)).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
    expect(emoji).not.toContain('�');
  });
});

describe('a long turn is delivered, never refused', () => {
  /** Delivers a turn the way the app does and answers with the payload the backend would have been given. */
  async function post(turn: TalkTurn): Promise<MessagePayload> {
    let body = '';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isChallengeRequest(String(input))) return challengeResponse();
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ txid: 'direct:abc', seq: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    await deliverTurn(turn, { key: Uint8Array.from(Utils.toArray(GOV.toHex(), 'hex')), mayorKey: MAYOR.toPublicKey().toString(), direct: true, fetchImpl });
    const record = decodeRecordScript(Script.fromHex(JSON.parse(body).scriptHex));
    const payload = JSON.parse(Utils.toUTF8(Array.from(record!.payloadBytes))) as MessagePayload;
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(RECORD_PAYLOAD_LIMIT);
    return payload;
  }

  const turnWith = (text: string): TalkTurn => ({ talk: { id: crypto.randomUUID(), turn: 12 }, text, role: 'turn', model: 'fable', cut: true });

  it('a turn spoken over the old limit is refused by the record encoder', async () => {
    await expect(post(turnWith(words(2000)))).rejects.toThrow(/over the 10240-byte cap/);
  });

  it('a 2,000-word turn, cut at the cap, goes out and reads back with its "..."', async () => {
    const payload = await post(turnWith(capTurnText(words(2000))));
    const back = decodeTurn(decryptMessage(payload, MAYOR.toHex()));
    expect(back?.text.endsWith('...')).toBe(true);
    expect(back?.text.length).toBeGreaterThan(5000);
  });

  it('the biggest turn the line can make still goes, even when every character is escaped', async () => {
    await post(turnWith(capTurnText('"'.repeat(TURN_TEXT_MAX_BYTES * 2))));
    await post(turnWith(capTurnText('\n'.repeat(TURN_TEXT_MAX_BYTES * 2))));
    await post(turnWith(capTurnText('😀'.repeat(TURN_TEXT_MAX_BYTES))));
  });
});
