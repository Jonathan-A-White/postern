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

  it('carries the txid, the class and where a tap lands as notification data, for the click handler (plans/0021)', () => {
    expect(notificationSpecForClass('message', 'tx-abc').options.data).toEqual({ txid: 'tx-abc', class: 'message', url: '/?v=notice&tx=tx-abc&c=message' });
    expect(notificationSpecForClass('decision-needed', 'tx-abc').options.data).toEqual({ txid: 'tx-abc', class: 'decision-needed', url: '/?v=notice&tx=tx-abc&c=decision-needed' });
  });

  it("points a push with no record behind it (the watchdog's alarm) at the alarm itself, carrying what it said", () => {
    const spec = notificationSpecForClass('alarm', '', undefined, { title: 'desktop unreachable', body: 'since 09:12Z', ts: 1790000000 });
    expect(spec.options.data.url).toBe('/?v=alarm&title=desktop+unreachable&body=since+09%3A12Z&ts=1790000000');
  });

  it('sends a record-less push of any other class to where its class belongs', () => {
    expect(notificationSpecForClass('message', '').options.data.url).toBe('/?v=talk');
    expect(notificationSpecForClass('landing', '').options.data.url).toBe('/?v=needs');
  });

  it("uses the push's own title and body when the backend sends them (docs/api.md)", () => {
    const spec = notificationSpecForClass('alarm', '', undefined, { title: 'desktop unreachable', body: 'since 09:12Z' });
    expect(spec.title).toBe('desktop unreachable');
    expect(spec.options.body).toBe('since 09:12Z');
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

  it('sound off with vibrate on is not silent and keeps its vibrate pattern (a silent notification cannot vibrate)', () => {
    const vibrateOnly: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.message, sound: false, vibrate: true, quiet: false };
    const spec = notificationSpecForClass('message', 'tx1', vibrateOnly);
    expect(spec.options.silent).toBe(false);
    expect(spec.options.vibrate).toEqual([80]);
  });

  it('sound off and vibrate off marks the notification silent, with no vibrate pattern', () => {
    const muted: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.landing, sound: false, vibrate: false };
    const spec = notificationSpecForClass('landing', 'tx1', muted);
    expect(spec.options.silent).toBe(true);
    expect(spec.options.vibrate).toBeUndefined();
  });

  it('sound on and vibrate off is not silent and has no vibrate pattern', () => {
    const soundOnly: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.landing, sound: true, vibrate: false };
    const spec = notificationSpecForClass('landing', 'tx1', soundOnly);
    expect(spec.options.silent).toBe(false);
    expect(spec.options.vibrate).toBeUndefined();
  });

  it('quiet overrides sound and vibrate regardless of their own switches', () => {
    const quiet: ClassNotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS.alarm, quiet: true };
    const spec = notificationSpecForClass('alarm', 'tx1', quiet);
    expect(spec.options.silent).toBe(true);
    expect(spec.options.vibrate).toBeUndefined();
  });

  it('quiet is silent with no vibrate pattern whatever the sound and vibrate boxes say', () => {
    for (const sound of [true, false]) {
      for (const vibrate of [true, false]) {
        const spec = notificationSpecForClass('decision-needed', 'tx1', { sound, vibrate, stayUntilDismissed: true, quiet: true });
        expect(spec.options.silent).toBe(true);
        expect(spec.options.vibrate).toBeUndefined();
      }
    }
  });

  it('renotify and tag stay fixed per class regardless of settings', () => {
    const spec = notificationSpecForClass('alarm', 'tx1', { sound: false, vibrate: false, stayUntilDismissed: false, quiet: false });
    expect(spec.options.tag).toBe('alarm');
    expect(spec.options.renotify).toBe(true);
  });
});
