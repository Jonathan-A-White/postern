// An emergency whose job is done tells him something and asks nothing: it shows for ten minutes or until
// he dismisses it; a failed one shows until it is cleared (mw-gq6.277). And the notification's tap url
// is a route of its own.
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type EventRow } from '../../src/data/db';
import { bannerMsLeft, eventsRepo, INFORMATION_EMERGENCY_MS } from '../../src/data/repositories';
import { formatRoute, parseRoute } from '../../src/nav/route';
import { notificationSpecForEmergency } from '../../src/push/classOptions';

const NOW = Date.parse('2026-10-06T01:00:00Z');
const at = (agoMs: number) => new Date(NOW - agoMs).toISOString();

function emergency(seq: number, to: string, agoMs: number, extra: Partial<EventRow> = {}): EventRow {
  return { seq, ts: at(agoMs), kind: 'job', bead: '', actor: 'mayor@laptop', from: 'running', to, detail: `words ${seq}`, lane: 'emergency', ...extra };
}

beforeEach(async () => {
  await Promise.all([db.events.clear(), db.settings.clear()]);
});

describe('an information emergency (its job is done)', () => {
  it('shows in the banner within ten minutes of its time', async () => {
    await eventsRepo.addNew([emergency(10, 'done', 9 * 60_000)]);
    expect((await eventsRepo.latestEmergency(NOW))?.seq).toBe(10);
  });

  it('is gone from the banner after ten minutes', async () => {
    await eventsRepo.addNew([emergency(10, 'done', INFORMATION_EMERGENCY_MS + 1_000)]);
    expect(await eventsRepo.latestEmergency(NOW)).toBeUndefined();
  });

  it('goes when he dismisses it, and stays gone', async () => {
    await eventsRepo.addNew([emergency(10, 'done', 60_000)]);
    await eventsRepo.clearEmergency(10);
    expect(await eventsRepo.latestEmergency(NOW)).toBeUndefined();
  });

  it('lets an older failed emergency show once the newer information one is over', async () => {
    await eventsRepo.addNew([emergency(9, 'failed', 30 * 60_000, { actor: 'doctor@desktop' }), emergency(10, 'done', 11 * 60_000)]);
    expect((await eventsRepo.latestEmergency(NOW))?.seq).toBe(9);
  });

  it('counts down from the event time', () => {
    expect(bannerMsLeft(emergency(10, 'done', 4 * 60_000), NOW)).toBe(6 * 60_000);
  });
});

describe('a failed emergency', () => {
  it('shows however old it is, until it is cleared', async () => {
    await eventsRepo.addNew([emergency(9, 'failed', 3 * 3_600_000, { actor: 'doctor@desktop' })]);
    expect(bannerMsLeft(emergency(9, 'failed', 3 * 3_600_000), NOW)).toBeUndefined();
    expect((await eventsRepo.latestEmergency(NOW))?.seq).toBe(9);
    await eventsRepo.clearEmergency(9);
    expect(await eventsRepo.latestEmergency(NOW)).toBeUndefined();
  });
});

describe('the Emergency screen\'s events', () => {
  it('lists the emergency events newest first, tapped away or not, and no other lane', async () => {
    await eventsRepo.addNew([emergency(8, 'done', 5 * 3_600_000), emergency(9, 'failed', 60_000), { ...emergency(10, 'done', 60_000), lane: 'normal' }]);
    await eventsRepo.clearEmergency(9);
    expect((await eventsRepo.recentEmergencies(10)).map((event) => event.seq)).toEqual([9, 8]);
  });
});

describe('the emergency notification\'s tap url', () => {
  it('is the Emergency route, which reads back as that route', () => {
    const url = notificationSpecForEmergency('direct:abc').options.data?.url as string;
    expect(url).toBe('/?v=emergency');
    expect(parseRoute(url.slice(1))).toEqual({ view: 'emergency' });
    expect(formatRoute({ view: 'emergency' })).toBe('?v=emergency');
  });
});
