// The Mayor's ring on the phone (docs/protocol.md §21): the Talk line's route for an answered ring, the note it
// leaves above the hold button, and the Later taps waiting for the app to open.
import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/data/db';
import { db } from '../../src/data/db';
import { encodeCall, deliverCallLater, type CallRecord } from '../../src/services/call';
import { ringNote } from '../../src/model/call';
import { formatRoute, parseRoute } from '../../src/nav/route';
import { settingsRepo } from '../../src/data/repositories/settings-repo';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { vi } from 'vitest';

function row(txid: string, call: CallRecord | undefined, over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 1,
    class: 'call',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1000,
    ciphertext: '',
    plaintext: call ? encodeCall(call) : '',
    direction: 'received',
    read: true,
    ...over,
  };
}

const ring = (txid: string, at: number, text = 'Back now.') => row(txid, { role: 'ring', text, at }, { ts: at });
const turn = (ts: number) => row(`t${ts}`, undefined, { class: 'talk', direction: 'sent', ts, plaintext: '{"talk":"x","turn":1,"said":"hi"}' });

describe('the Talk line route of an answered ring', () => {
  it('carries the ring it answers as ?call=', () => {
    expect(parseRoute('?v=line&call=direct%3Aring1')).toEqual({ view: 'line', call: 'direct:ring1' });
    expect(formatRoute({ view: 'line', call: 'direct:ring1' })).toBe('?v=line&call=direct%3Aring1');
    expect(parseRoute('?v=line')).toEqual({ view: 'line' });
    expect(formatRoute({ view: 'line' })).toBe('?v=line');
  });
});

describe('the note a ring leaves on the Talk line', () => {
  it('is a missed call until he answers it', () => {
    expect(ringNote([ring('r1', 5000)], undefined)).toEqual({ txid: 'r1', at: 5000, text: 'Back now.', missed: true });
  });

  it('is the Mayor calling once he answered that ring', () => {
    expect(ringNote([ring('r1', 5000)], 'r1')?.missed).toBe(false);
    expect(ringNote([ring('r1', 5000)], 'older')?.missed).toBe(true);
  });

  it('shows the newest ring only', () => {
    expect(ringNote([ring('r1', 5000, 'first'), ring('r2', 6000, 'second')], 'r1')).toEqual({ txid: 'r2', at: 6000, text: 'second', missed: true });
  });

  it('goes once he sends a turn after the ring, and not for a turn before it', () => {
    expect(ringNote([ring('r1', 5000), turn(5001)], undefined)).toBeUndefined();
    expect(ringNote([ring('r1', 5000), turn(4000)], undefined)?.txid).toBe('r1');
  });

  it('ignores his own call records and a ring that is not readable', () => {
    const mine = row('m1', { role: 'ring', text: 'x', at: 9000 }, { direction: 'sent' });
    expect(ringNote([mine, row('junk', undefined)], undefined)).toBeUndefined();
    expect(ringNote([], undefined)).toBeUndefined();
  });
});

describe('Later taps waiting for the app to open', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('are kept once each and handed over once', async () => {
    await settingsRepo.addPendingLater('direct:r1');
    await settingsRepo.addPendingLater('direct:r2');
    await settingsRepo.addPendingLater('direct:r1');
    expect(await settingsRepo.takePendingLaters()).toEqual(['direct:r1', 'direct:r2']);
    expect(await settingsRepo.takePendingLaters()).toEqual([]);
  });

  it('remembers the ring he answered', async () => {
    expect(await settingsRepo.get('answeredRing')).toBeUndefined();
    await settingsRepo.setAnsweredRing('direct:r1');
    expect(await settingsRepo.get('answeredRing')).toBe('direct:r1');
  });
});

describe('the Later record', () => {
  it('is delivered to the Mayor as class call, naming the ring', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isChallengeRequest(String(input))) return challengeResponse();
      expect(String(input)).toContain('/messages');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ txid: 'direct:later1' }), { status: 201 });
    });
    const { PrivateKey } = await import('@bsv/sdk');
    const delivered = await deliverCallLater('direct:r1', {
      key: new Uint8Array(32).fill(0x45),
      mayorKey: PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString(),
      direct: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(delivered.txid).toBe('direct:later1');
    await (await import('../../src/services/deliver')).settledWrites();
    const sent = await db.messages.get('direct:later1:0');
    expect(sent?.class).toBe('call');
    expect(JSON.parse(sent?.plaintext ?? '{}')).toEqual({ role: 'later', ring_txid: 'direct:r1' });
  });
});
