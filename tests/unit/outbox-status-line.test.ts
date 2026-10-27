// tests/unit/outbox-status-line.test.ts — mw-gb92lmo AC-2: while the phone reaches the backend (live or
// polling) the status line never says 'Sending when back online'; it says what truly holds the row, from
// the row's own state. Offline it still says so.
import { describe, expect, it } from 'vitest';
import type { OutboxRow } from '../../src/data/db';
import { CHAIN_HOLD_MS, SENDING_WHEN_BACK, outboxLine } from '../../src/model/outbox';
import { backendReachable, type LiveState } from '../../src/services/live';

const NOW = 1_000_000;

function row(over: Partial<OutboxRow>): OutboxRow {
  return { id: 1, kind: 'message', bead: '', payload: { text: 'hi', files: [] }, created: 1000, attempts: 0, state: 'pending', ...over };
}

describe('the status line while the backend is reached', () => {
  it('says nothing for a row that has not yet been tried', () => {
    expect(outboxLine([row({})], NOW, true)).toBeUndefined();
  });

  it('says nothing when the outbox is empty', () => {
    expect(outboxLine([], NOW, true)).toBeUndefined();
  });

  it('counts down to the next try of a row that failed', () => {
    expect(outboxLine([row({ attempts: 1, nextAt: NOW + 4_200 })], NOW, true)).toBe('Retrying in 5 s');
    expect(outboxLine([row({ attempts: 2, nextAt: NOW + 1_000 })], NOW, true)).toBe('Retrying in 1 s');
  });

  it('says it is sending once the next try is due', () => {
    expect(outboxLine([row({ attempts: 1, nextAt: NOW - 1 })], NOW, true)).toBe('Sending…');
    expect(outboxLine([row({ attempts: 1, nextAt: NOW })], NOW, true)).toBe('Sending…');
  });

  it('says a row waits for the key when the sender has no way to send yet', () => {
    expect(outboxLine([row({ attempts: 1 })], NOW, true)).toBe("Waiting for the Mayor's key before sending");
  });

  it('names a refused row and what he can do', () => {
    expect(outboxLine([row({ state: 'failed', attempts: 1, failure: 'too big' })], NOW, true)).toBe('Not sent: the backend refused it. Tap Retry or Discard.');
  });

  it('says a turn waits on an earlier turn that was refused, and what he can do about it', () => {
    const rows = [row({ id: 1, kind: 'turn', state: 'failed', attempts: 1 }), row({ id: 2, kind: 'turn', payload: {} })];
    expect(outboxLine(rows, NOW, true)).toBe('Waiting on an earlier turn that was refused: tap Retry or Discard on it');
  });

  it('says a turn waits on an earlier turn that went on the chain and has not been seen, until the hold is over', () => {
    const rows = [row({ id: 1, kind: 'turn', state: 'sent', txid: 'ab'.repeat(32), sentAt: NOW - 1000 }), row({ id: 2, kind: 'turn', payload: {}, attempts: 1, nextAt: NOW + 3000 })];
    expect(outboxLine(rows, NOW, true)).toBe('Waiting on an earlier turn to be seen');
    expect(outboxLine(rows, NOW + CHAIN_HOLD_MS, true)).toBe('Sending…');
  });

  it('never says Sending when back online, whatever the rows', () => {
    const cases = [row({ attempts: 1 }), row({ attempts: 3, nextAt: NOW + 9000 }), row({ attempts: 1, nextAt: NOW - 5 }), row({ state: 'failed', attempts: 1 })];
    for (const one of cases) expect(outboxLine([one], NOW, true)).not.toBe(SENDING_WHEN_BACK);
  });
});

describe('the status line while the backend is out of reach', () => {
  it('still says Sending when back online for a row whose first try failed', () => {
    expect(outboxLine([row({ attempts: 1, nextAt: NOW + 4000 })], NOW, false)).toBe(SENDING_WHEN_BACK);
  });

  it('says nothing for a row not yet tried, or a refused one', () => {
    expect(outboxLine([row({})], NOW, false)).toBeUndefined();
    expect(outboxLine([row({ state: 'failed', attempts: 1 })], NOW, false)).toBeUndefined();
  });
});

describe('what the status line takes for reached (mw-j4usch0 AC-4)', () => {
  const live = (over: Partial<LiveState>): LiveState => ({ status: 'live', me: null, reconnects: 0, syncs: 0, ...over });

  it('is the stream open, or polling', () => {
    expect(backendReachable(live({ status: 'live' }))).toBe(true);
    expect(backendReachable(live({ status: 'polling' }))).toBe(true);
  });

  it('is a stream that is down while the backend answers its syncs and probes', () => {
    expect(backendReachable(live({ status: 'reconnecting', reached: true }))).toBe(true);
    expect(backendReachable(live({ status: 'connecting', reached: true }))).toBe(true);
    // The line then counts down to the next try, not 'Sending when back online'.
    expect(outboxLine([row({ attempts: 6, nextAt: NOW + 60_000 })], NOW, backendReachable(live({ status: 'reconnecting', reached: true })))).toBe('Retrying in 60 s');
  });

  it('is not a stream that is down while nothing the backend was asked has been answered', () => {
    expect(backendReachable(live({ status: 'reconnecting' }))).toBe(false);
    expect(backendReachable(live({ status: 'reconnecting', reached: false }))).toBe(false);
    expect(backendReachable(live({ status: 'offline' }))).toBe(false);
    expect(backendReachable(live({ status: 'idle', reached: true }))).toBe(false);
    expect(backendReachable(live({ status: 'unlicensed', reached: true }))).toBe(false);
  });
});
