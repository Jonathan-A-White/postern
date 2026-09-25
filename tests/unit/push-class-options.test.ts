import { describe, it, expect } from 'vitest';
import { notificationSpecForClass, DEFAULT_NOTIFICATION_SETTINGS } from '../../src/push/classOptions';
import type { ClassNotificationSettings } from '../../src/push/classOptions';

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

  it("defaults every class's settings to the decided (undecorated) behaviour", () => {
    for (const messageClass of Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as Array<keyof typeof DEFAULT_NOTIFICATION_SETTINGS>) {
      const withDefault = notificationSpecForClass(messageClass, 'tx1');
      const withExplicitDefault = notificationSpecForClass(messageClass, 'tx1', DEFAULT_NOTIFICATION_SETTINGS[messageClass]);
      expect(withDefault).toEqual(withExplicitDefault);
    }
  });

  it('turning off vibrate for one class drops its vibrate pattern without touching other classes', () => {
    const noVibrate: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.message, vibrate: false };
    const spec = notificationSpecForClass('message', 'tx1', noVibrate);
    expect(spec.options.vibrate).toBeUndefined();

    const alarmSpec = notificationSpecForClass('alarm', 'tx1');
    expect(alarmSpec.options.vibrate).toBeDefined();
  });

  it('turning off stay-until-dismissed clears requireInteraction', () => {
    const notSticky: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.alarm, stayUntilDismissed: false };
    const spec = notificationSpecForClass('alarm', 'tx1', notSticky);
    expect(spec.options.requireInteraction).toBeFalsy();
  });

  it('turning off sound marks the notification silent', () => {
    const muted: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.landing, sound: false };
    const spec = notificationSpecForClass('landing', 'tx1', muted);
    expect(spec.options.silent).toBe(true);
  });

  it('quiet overrides sound and vibrate regardless of their own switches', () => {
    const quiet: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.alarm, quiet: true };
    const spec = notificationSpecForClass('alarm', 'tx1', quiet);
    expect(spec.options.silent).toBe(true);
    expect(spec.options.vibrate).toBeUndefined();
  });

  it('renotify and tag stay fixed per class regardless of settings', () => {
    const spec = notificationSpecForClass('alarm', 'tx1', { sound: false, vibrate: false, stayUntilDismissed: false, quiet: false });
    expect(spec.options.tag).toBe('alarm');
    expect(spec.options.renotify).toBe(true);
  });
});
