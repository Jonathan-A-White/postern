// tests/unit/live-label.test.ts — the connection badge's words (mw-t64a3.11).
import { describe, it, expect } from 'vitest';
import { liveLabel } from '../../src/cockpit/liveLabel';

describe('liveLabel', () => {
  it('says Reconnecting, in the needs tone, while the stream is being re-made', () => {
    expect(liveLabel({ status: 'reconnecting', me: null, reconnects: 0, syncs: 0, lastHeard: 1000 }, 5000)).toEqual({ text: 'Reconnecting…', tone: 'needs' });
  });

  it('still says Offline, with how long ago, once the backend has not answered', () => {
    const label = liveLabel({ status: 'offline', me: null, reconnects: 0, syncs: 0, lastHeard: 1000 }, 61_000);
    expect(label.text).toMatch(/^Offline · /);
    expect(label.tone).toBe('blocked');
  });

  it('says Live from the chain while the backend is out of reach and the phone is reading the chain', () => {
    for (const status of ['reconnecting', 'offline'] as const) {
      expect(liveLabel({ status, me: null, reconnects: 0, syncs: 0, lastHeard: 1000, chainLive: true }, 61_000)).toEqual({ text: 'Live from the chain', tone: 'needs' });
    }
  });

  it('says Live, not Live from the chain, once the stream is back', () => {
    expect(liveLabel({ status: 'live', me: null, reconnects: 1, syncs: 1, chainLive: true }, 5000).text).toBe('Live');
  });
});
