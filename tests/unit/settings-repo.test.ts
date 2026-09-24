import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';

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
});
