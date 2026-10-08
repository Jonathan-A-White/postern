// tests/unit/remembered.test.ts — mw-xhtcup.14: whether a one-tap action he has sent is still
// waiting is decided by seqs when the view carries one (the tap waits until the view has
// passed the event that echoed its txid), never by comparing the phone's clock with the
// host's written_at; a view with no seq (an older mw) keeps the clock rule.
import { describe, expect, it } from 'vitest';
import type { AnswerRow } from '../../src/data/db';
import { actionRemembered, rememberedTxid } from '../../src/cockpit/remembered';
import { projectEvents } from '../../src/model/events';
import { decodeView, emptyView } from '../../src/model/view';

const WRITTEN = '2026-10-01T12:00:00Z';
const writtenMs = Date.parse(WRITTEN);

/** The row the outbox writes on delivery: tapped against a view of seq 10 unless said. */
function row(over: Partial<AnswerRow> = {}): AnswerRow {
  return { bead: 'mw-a', answer: 'release', txid: 'tx-1', ts: Math.floor(writtenMs / 1000) + 600, viewSeq: 10, ...over };
}

describe('actionRemembered with a view that carries a seq', () => {
  it('waits while no event has echoed the tap, whatever the view seq', () => {
    expect(actionRemembered([row()], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 11 }, undefined)).toBe(true);
  });

  it('waits while the view has not reached the echo event', () => {
    expect(actionRemembered([row()], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 11 }, 12)).toBe(true);
  });

  it('is over once the view has reached the echo event, even though the phone clock says the tap is newer', () => {
    // ts is ten minutes after written_at, as when the phone clock runs slow or the view was built before the tap.
    expect(actionRemembered([row()], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 12 }, 12)).toBe(false);
    expect(actionRemembered([row()], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 15 }, 12)).toBe(false);
  });

  it('is over for a fast phone clock too: written_at older than the tap does not keep it waiting', () => {
    const fast = row({ ts: Math.floor(writtenMs / 1000) - 600 });
    expect(actionRemembered([fast], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 12 }, 12)).toBe(false);
  });

  it('still waits for a view of a lower seq when the phone clock is far ahead of the host', () => {
    const fast = row({ ts: Math.floor(writtenMs / 1000) - 600 });
    expect(actionRemembered([fast], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 11 }, 12)).toBe(true);
  });
});

describe('actionRemembered falls back to the clock', () => {
  it('for a view with no seq (an older mw): newer than written_at waits, older does not', () => {
    expect(actionRemembered([row({ ts: Math.floor(writtenMs / 1000) + 5 })], 'mw-a', 'release', { writtenAt: WRITTEN, seq: undefined }, 12)).toBe(true);
    expect(actionRemembered([row({ ts: Math.floor(writtenMs / 1000) - 5 })], 'mw-a', 'release', { writtenAt: WRITTEN, seq: undefined }, 12)).toBe(false);
  });

  it('for a tap made against a view with no seq, even if the view now has one', () => {
    const old = row({ viewSeq: undefined, ts: Math.floor(writtenMs / 1000) - 5 });
    expect(actionRemembered([old], 'mw-a', 'release', { writtenAt: WRITTEN, seq: 20 }, undefined)).toBe(false);
  });

  it('when the view has no readable time either', () => {
    expect(actionRemembered([row()], 'mw-a', 'release', { writtenAt: undefined, seq: undefined })).toBe(true);
  });
});

describe('actionRemembered ignores other taps', () => {
  it('another bead or another action is not remembered', () => {
    expect(actionRemembered([row()], 'mw-b', 'release', { writtenAt: WRITTEN, seq: 11 }, undefined)).toBe(false);
    expect(actionRemembered([row()], 'mw-a', 'hold', { writtenAt: WRITTEN, seq: 11 }, undefined)).toBe(false);
  });

  it('rememberedTxid names the txid of the tap to look for an echo of', () => {
    expect(rememberedTxid([row()], 'mw-a', 'release')).toBe('tx-1');
    expect(rememberedTxid([row()], 'mw-a', 'hold')).toBeUndefined();
  });
});

describe('the view carries its seq', () => {
  const lookups = { question: () => undefined, answer: () => undefined };
  const event = (seq: number) => ({ seq, ts: '2026-10-01T12:00:00Z', kind: 'job', bead: '', actor: '', from: '', to: '', detail: '', lane: 'ordinary' });

  it('decodeView reads an optional numeric seq and leaves it absent otherwise', () => {
    const base = { v: 2, written_at: WRITTEN, host: 'd', hosts: [], needs: [], beads: [] };
    expect(decodeView(JSON.stringify({ ...base, seq: 42 })).seq).toBe(42);
    expect(decodeView(JSON.stringify(base)).seq).toBeUndefined();
    expect(decodeView(JSON.stringify({ ...base, seq: 'x' })).seq).toBeUndefined();
  });

  it('the projection carries seq forward as the largest seen, never the last applied', () => {
    const view = { ...emptyView(), seq: 10 };
    expect(projectEvents(view, [event(12), event(11)], lookups).view.seq).toBe(12);
    expect(projectEvents(view, [event(8)], lookups).view.seq).toBe(10);
  });

  it('a view with no seq stays without one', () => {
    expect(projectEvents(emptyView(), [event(12)], lookups).view.seq).toBeUndefined();
  });
});
