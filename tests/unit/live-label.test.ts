// tests/unit/live-label.test.ts — the connection badge's words (mw-t64a3.11).
import { describe, it, expect } from 'vitest';
import { liveLabel } from '../../src/cockpit/liveLabel';

describe('liveLabel', () => {
  it('says Reconnecting, in the needs tone, while the stream is being re-made', () => {
    expect(liveLabel({ status: 'reconnecting', me: null, lastHeard: 1000 }, 5000)).toEqual({ text: 'Reconnecting…', tone: 'needs' });
  });

  it('still says Offline, with how long ago, once the backend has not answered', () => {
    const label = liveLabel({ status: 'offline', me: null, lastHeard: 1000 }, 61_000);
    expect(label.text).toMatch(/^Offline · /);
    expect(label.tone).toBe('blocked');
  });
});
