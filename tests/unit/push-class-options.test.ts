import { describe, it, expect } from 'vitest';
import { notificationSpecForClass } from '../../src/push/classOptions';

describe('notificationSpecForClass', () => {
  it('decision-needed vibrates and stays until dismissed', () => {
    const spec = notificationSpecForClass('decision-needed', 'tx1');
    expect(spec.options.vibrate).toBeDefined();
    expect(spec.options.requireInteraction).toBe(true);
  });

  it('landing is a normal alert whose repeats replace each other', () => {
    const spec = notificationSpecForClass('landing', 'tx1');
    expect(spec.options.tag).toBe('landing');
    expect(spec.options.requireInteraction).toBeFalsy();
    expect(spec.options.renotify).toBeFalsy();
  });

  it('alarm is loud, insistent, and re-alerts on repeat', () => {
    const spec = notificationSpecForClass('alarm', 'tx1');
    expect(spec.options.vibrate).toBeDefined();
    expect(spec.options.requireInteraction).toBe(true);
    expect(spec.options.tag).toBe('alarm');
    expect(spec.options.renotify).toBe(true);
  });

  it('message is a quiet, watch-friendly buzz', () => {
    const spec = notificationSpecForClass('message', 'tx1');
    expect(spec.options.vibrate).toBeDefined();
    expect(spec.options.requireInteraction).toBeFalsy();
    expect(spec.options.renotify).toBeFalsy();
  });

  it('carries the txid through as notification data, for the click handler', () => {
    const spec = notificationSpecForClass('message', 'tx-abc');
    expect(spec.options.data).toEqual({ txid: 'tx-abc' });
  });

  it('titles each class', () => {
    expect(notificationSpecForClass('decision-needed', 'tx1').title).toBe('Decision needed');
    expect(notificationSpecForClass('landing', 'tx1').title).toBe('Landing to verify');
    expect(notificationSpecForClass('alarm', 'tx1').title).toBe('Alarm');
    expect(notificationSpecForClass('message', 'tx1').title).toBe('Message');
  });
});
