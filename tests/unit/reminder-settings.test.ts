// tests/unit/reminder-settings.test.ts — mw-ev7oyy.9: the Reminders setting, apart from the per-class
// notification switches, and a reminder push honouring it in the real service worker (src/sw.ts under
// tests/support/sw-harness.ts). A plain PWA has no channel of its own for a kind of push
// (docs/research/notifications.md §1), so the worker reads this setting and decides per notification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { DEFAULT_REMINDER_SETTINGS, REMINDER_TITLE, inQuietHours, notificationSpecForReminder, type ReminderSettings } from '../../src/push/reminder';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../support/sw-harness';

const TXID = `direct:${'ab'.repeat(32)}`;
const at = (time: string) => new Date(`2026-10-13T${time}:00Z`);
const quiet = (extra: Partial<ReminderSettings> = {}): ReminderSettings => ({ ...DEFAULT_REMINDER_SETTINGS, quietHours: true, ...extra });

describe('inQuietHours', () => {
  it('is never true while quiet hours are off', () => {
    expect(inQuietHours(DEFAULT_REMINDER_SETTINGS, at('23:30'))).toBe(false);
  });

  it('covers a same-day span from its start up to, not including, its end', () => {
    const settings = quiet({ quietFrom: '13:00', quietTo: '15:00' });
    expect(inQuietHours(settings, at('12:59'))).toBe(false);
    expect(inQuietHours(settings, at('13:00'))).toBe(true);
    expect(inQuietHours(settings, at('14:59'))).toBe(true);
    expect(inQuietHours(settings, at('15:00'))).toBe(false);
  });

  it('runs past midnight when the end is before the start', () => {
    const settings = quiet({ quietFrom: '22:00', quietTo: '07:00' });
    expect(inQuietHours(settings, at('21:59'))).toBe(false);
    expect(inQuietHours(settings, at('23:30'))).toBe(true);
    expect(inQuietHours(settings, at('06:59'))).toBe(true);
    expect(inQuietHours(settings, at('07:00'))).toBe(false);
  });

  it('is never true when the start and the end are the same minute', () => {
    expect(inQuietHours(quiet({ quietFrom: '08:00', quietTo: '08:00' }), at('08:00'))).toBe(false);
  });
});

describe('notificationSpecForReminder', () => {
  it('sounds, buzzes and stays until dismissed by default, and a tap lands on the To do board', () => {
    const spec = notificationSpecForReminder(TXID, DEFAULT_REMINDER_SETTINGS, at('12:00'), { body: 'Call the bank' });
    expect(spec.title).toBe(REMINDER_TITLE);
    expect(spec.options).toMatchObject({ silent: false, requireInteraction: true, body: 'Call the bank' });
    expect(spec.options.vibrate?.length).toBeGreaterThan(0);
    expect(spec.options.data).toEqual({ txid: TXID, class: 'reminder', url: '/?v=todo' });
  });

  it('is silent, with no buzz, when Sound is off', () => {
    const spec = notificationSpecForReminder(TXID, { ...DEFAULT_REMINDER_SETTINGS, sound: false }, at('12:00'));
    expect(spec.options.silent).toBe(true);
    expect(spec.options.vibrate).toBeUndefined();
  });

  it('is silent, but still shown, inside quiet hours', () => {
    const spec = notificationSpecForReminder(TXID, quiet(), at('23:30'));
    expect(spec.options.silent).toBe(true);
    expect(spec.options.vibrate).toBeUndefined();
    expect(spec.title).toBe(REMINDER_TITLE);
  });

  it("uses the push's own title when it has one", () => {
    expect(notificationSpecForReminder(TXID, DEFAULT_REMINDER_SETTINGS, at('12:00'), { title: 'Due: Call the bank' }).title).toBe('Due: Call the bank');
  });
});

describe('the Reminders setting is apart from the per-class switches', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('is stored on its own, defaulting to sound on and quiet hours off', async () => {
    expect(await settingsRepo.getReminderSettings()).toEqual(DEFAULT_REMINDER_SETTINGS);
    await settingsRepo.setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, sound: false });
    expect((await settingsRepo.getReminderSettings()).sound).toBe(false);
    expect((await settingsRepo.getNotificationSettings()).message.sound).toBe(true);
  });

  it("is not moved by Reset to defaults of the other classes' switches", async () => {
    await settingsRepo.setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, sound: false });
    await settingsRepo.resetNotificationSettings();
    expect((await settingsRepo.getReminderSettings()).sound).toBe(false);
  });

  it('is not changed by turning a class off', async () => {
    const all = await settingsRepo.getNotificationSettings();
    await settingsRepo.setNotificationSettings({ ...all, message: { ...all.message, quiet: true } });
    expect(await settingsRepo.getReminderSettings()).toEqual(DEFAULT_REMINDER_SETTINGS);
  });
});

describe('a reminder push in the real service worker', () => {
  let worker: WorkerHarness;

  beforeEach(async () => {
    worker = await loadWorker();
    await db.settings.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('12:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a reminder with sound by default, even over an open app', async () => {
    worker.openWindows.push(fakeWindowClient('https://postern.allmymind.org/?v=todo'));
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_000, title: 'Due now', body: 'Call the bank' });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].title).toBe('Due now');
    expect(worker.shown[0].options).toMatchObject({ silent: false, requireInteraction: true, body: 'Call the bank' });
  });

  it('honours Sound off: the reminder shows, silent', async () => {
    await settingsRepo.setReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, sound: false });
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_000 });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].options.silent).toBe(true);
  });

  it('honours quiet hours: silent inside them, with sound outside them', async () => {
    await settingsRepo.setReminderSettings(quiet({ quietFrom: '11:00', quietTo: '13:00' }));
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_000 });
    vi.setSystemTime(at('14:00'));
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_001 });
    expect(worker.shown.map((n) => n.options.silent)).toEqual([true, false]);
  });

  it("does not take the message class's switches: Quiet on messages leaves a reminder audible", async () => {
    const all = await settingsRepo.getNotificationSettings();
    await settingsRepo.setNotificationSettings({ ...all, message: { ...all.message, quiet: true, sound: false } });
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_000 });
    expect(worker.shown[0].options.silent).toBe(false);
  });

  it('opens the To do board on a tap', async () => {
    await worker.push({ class: 'reminder', txid: TXID, ts: 1_790_000_000 });
    const app = fakeWindowClient();
    worker.openWindows.push(app);
    await worker.click(worker.open[worker.open.length - 1]);
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'open', url: '/?v=todo', account: '1' });
  });
});
