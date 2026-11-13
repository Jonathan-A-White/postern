// tests/unit/has-news-since.test.ts: the judge Postern hands pwa-kit/app-update (mw-6ww.175.34): it reads the changelog fresh
// and says whether any line is after the running version; a changelog it cannot read rejects, so the banner is offered.
import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from 'pwa-kit/whats-new';
import { hasNewsSince } from '../../src/services/whatsNew';

const entry = (version: string): ChangelogEntry => ({ version, date: '2026-11-13', story: 'fx-1', kind: 'fixed', text: 'A line.' });

describe('hasNewsSince', () => {
  it('is false when nothing is after the running version', async () => {
    await expect(hasNewsSince(async () => [entry('0.8.105'), entry('0.8.104')])('0.8.105')).resolves.toBe(false);
  });

  it('is true when a line is after the running version, even if the newest build has none of its own', async () => {
    await expect(hasNewsSince(async () => [entry('0.8.107'), entry('0.8.105')])('0.8.105')).resolves.toBe(true);
  });

  it('rejects when the changelog is null, so the banner is offered', async () => {
    await expect(hasNewsSince(async () => null)('0.8.105')).rejects.toThrow();
  });

  it('rejects when the read rejects', async () => {
    await expect(hasNewsSince(() => Promise.reject(new Error('offline')))('0.8.105')).rejects.toThrow('offline');
  });
});
