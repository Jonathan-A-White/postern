// An event with `clears: N` (docs/events.md) takes emergency N, and any below it, as resolved (mw-gq6.247).
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type EventRow } from '../../src/data/db';
import { eventsRepo } from '../../src/data/repositories';
import { decodeEventBatch } from '../../src/model/events';

function event(seq: number, lane: string, extra: Partial<EventRow> = {}): EventRow {
  return { seq, ts: '2026-10-03T12:00:00Z', kind: 'job', bead: '', actor: 'doctor@desktop', from: '', to: '', detail: '', lane, ...extra };
}

const emergency = (seq: number) => event(seq, 'emergency', { from: 'running', to: 'failed', detail: `alarm ${seq}` });
const back = (seq: number, clears?: number) => event(seq, 'normal', { from: 'running', to: 'done', detail: 'answers again', ...(clears === undefined ? {} : { clears }) });

beforeEach(async () => {
  await Promise.all([db.events.clear(), db.settings.clear()]);
});

describe('an event that clears an emergency', () => {
  it('drops the emergency it names from the banner', async () => {
    await eventsRepo.addNew([emergency(100)]);
    expect((await eventsRepo.latestEmergency())?.seq).toBe(100);
    await eventsRepo.addNew([back(101, 100)]);
    expect(await eventsRepo.latestEmergency()).toBeUndefined();
  });

  it('never hides a newer emergency than the one it names', async () => {
    await eventsRepo.addNew([emergency(100), emergency(105)]);
    await eventsRepo.addNew([back(106, 100)]);
    expect((await eventsRepo.latestEmergency())?.seq).toBe(105);
  });

  it('clears an emergency below the one it names too', async () => {
    await eventsRepo.addNew([emergency(100), emergency(105)]);
    await eventsRepo.addNew([back(106, 105)]);
    expect(await eventsRepo.latestEmergency()).toBeUndefined();
  });

  it('is kept as a setting, so the clear survives a reload', async () => {
    await eventsRepo.addNew([emergency(100), back(101, 100)]);
    expect(await eventsRepo.emergencyCleared()).toBe(100);
    expect(await eventsRepo.latestEmergency()).toBeUndefined();
  });

  it('works when it arrives before the emergency it names', async () => {
    await eventsRepo.addNew([back(101, 100)]);
    await eventsRepo.addNew([emergency(100)]);
    expect(await eventsRepo.latestEmergency()).toBeUndefined();
  });

  it('never lowers what he has tapped away', async () => {
    await eventsRepo.clearEmergency(110);
    await eventsRepo.addNew([back(111, 100)]);
    expect(await eventsRepo.emergencyCleared()).toBe(110);
  });
});

describe('an event without clears', () => {
  it('changes nothing', async () => {
    await eventsRepo.addNew([emergency(100), back(101)]);
    expect((await eventsRepo.latestEmergency())?.seq).toBe(100);
    expect(await eventsRepo.emergencyCleared()).toBe(0);
  });
});

describe('decodeEventBatch and clears', () => {
  const raw = (extra: Record<string, unknown>) =>
    JSON.stringify({ from: 101, to: 101, lane: 'normal', events: [{ seq: 101, ts: '2026-10-03T12:00:00Z', kind: 'job', bead: '', actor: 'doctor@desktop', from: 'running', to: 'done', detail: 'answers again', lane: 'normal', ...extra }] });

  it('reads the seq an event clears', () => {
    expect(decodeEventBatch(raw({ clears: 100 })).events[0].clears).toBe(100);
  });

  it('leaves clears off an event that names none, or names nonsense', () => {
    expect('clears' in decodeEventBatch(raw({})).events[0]).toBe(false);
    expect('clears' in decodeEventBatch(raw({ clears: 'x' })).events[0]).toBe(false);
    expect('clears' in decodeEventBatch(raw({ clears: 0 })).events[0]).toBe(false);
  });
});
