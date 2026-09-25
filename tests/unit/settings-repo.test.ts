import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/push/classOptions';

describe('settingsRepo', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('round-trips a value through fake-indexeddb', async () => {
    await settingsRepo.set('theme', 'dark');
    const value = await settingsRepo.get('theme');
    expect(value).toBe('dark');
  });

  it('returns undefined for a key that was never set', async () => {
    const value = await settingsRepo.get('missing');
    expect(value).toBeUndefined();
  });

  describe('notification settings', () => {
    it('preloads the decided defaults when nothing has been stored', async () => {
      const settings = await settingsRepo.getNotificationSettings();
      expect(settings).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    });

    it('round-trips a changed setting for one class only', async () => {
      const changed = {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        message: { ...DEFAULT_NOTIFICATION_SETTINGS.message, vibrate: false },
      };
      await settingsRepo.setNotificationSettings(changed);

      const settings = await settingsRepo.getNotificationSettings();
      expect(settings.message.vibrate).toBe(false);
      expect(settings.alarm).toEqual(DEFAULT_NOTIFICATION_SETTINGS.alarm);
    });

    it('resets to the decided defaults', async () => {
      await settingsRepo.setNotificationSettings({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        message: { ...DEFAULT_NOTIFICATION_SETTINGS.message, vibrate: false },
      });

      await settingsRepo.resetNotificationSettings();

      const settings = await settingsRepo.getNotificationSettings();
      expect(settings).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    });
  });
});
