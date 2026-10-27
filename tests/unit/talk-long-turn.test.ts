// A long hold must always send (mw-j0f2d.15). The cause of the old 'Could not send' was
// the record's size limit: spell-forge-bsv's encodeRecordScript throws when a record's payload
// (the envelope with the base64 ciphertext) passes 10,240 bytes, which is about 7,250 bytes of
// the turn's JSON. So a turn over TURN_TEXT_MAX_BYTES goes as several records, part k of n (mw-8ifimx.16), and every one goes.
import { describe, it, expect, vi } from 'vitest';
import { PrivateKey, Script, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { deliverTurn, decodeTurn } from '../../src/services/talk';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import { turnRecords, TURN_TEXT_MAX_BYTES, type TalkTurn } from '../../src/model/talkLine';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const RECORD_PAYLOAD_LIMIT = 10 * 1024;
const GOV = PrivateKey.fromRandom();
const MAYOR = PrivateKey.fromRandom();
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 97}`).join(' ');

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

  it('a turn spoken over the old limit, sent as one record, is refused on the phone before the record encoder (mw-fjpe9tx)', async () => {
    await expect(post(turnWith(words(2000)))).rejects.toThrow(/^Too long to send: \d+ bytes, and one record takes 10240\.$/);
  });

  it('a 2,000-word turn goes as parts that each go out and read back, joined to what he said', async () => {
    const text = words(2000);
    const records = turnRecords(turnWith(text), 0);
    expect(records.length).toBeGreaterThan(1);
    const back: TalkTurn[] = [];
    for (const record of records) back.push(decodeTurn(decryptMessage(await post(record), MAYOR.toHex()))!);
    expect(back.map((part) => [part.part, part.parts])).toEqual(records.map((_, i) => [i + 1, records.length]));
    expect(back.map((part) => part.text).join('')).toBe(text);
  });

  it('the biggest parts the line can make still go, even when every character is escaped', async () => {
    for (const text of ['"'.repeat(TURN_TEXT_MAX_BYTES * 2), '\n'.repeat(TURN_TEXT_MAX_BYTES * 2), '😀'.repeat(TURN_TEXT_MAX_BYTES)]) {
      for (const record of turnRecords(turnWith(text), 0)) await post(record);
    }
  });
});
