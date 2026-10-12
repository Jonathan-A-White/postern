// tests/unit/ideas-only-model.test.ts — mw-8ifimx.3: the presets' time sums and the schedule draft.
import { describe, expect, it } from 'vitest';
import {
  describeUntil,
  draftOf,
  draftProblem,
  presetUntil,
  readAnswer,
  stateAt,
  untilFromLocal,
  withSchedule,
  withoutSchedule,
} from '../../src/model/ideasOnly';

const at = (y: number, mo: number, d: number, h: number, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime();
const secs = (ms: number): number => Math.floor(ms / 1000);

describe('presets', () => {
  it('Until 9 pm is today at 21:00 before 21:00 and tomorrow at 21:00 after it', () => {
    expect(presetUntil('nine', at(2026, 10, 1, 14))).toBe(secs(at(2026, 10, 1, 21)));
    expect(presetUntil('nine', at(2026, 10, 1, 21))).toBe(secs(at(2026, 10, 2, 21)));
    expect(presetUntil('nine', at(2026, 10, 1, 23, 59))).toBe(secs(at(2026, 10, 2, 21)));
  });

  it('Until 7 am tomorrow is the next calendar day at 07:00', () => {
    expect(presetUntil('seven', at(2026, 10, 1, 14))).toBe(secs(at(2026, 10, 2, 7)));
    expect(presetUntil('seven', at(2026, 10, 31, 22))).toBe(secs(at(2026, 11, 1, 7)));
  });

  it('For an hour is now plus 3600 seconds', () => {
    expect(presetUntil('hour', 1_790_000_000_500)).toBe(1_790_003_600);
  });

  it('Until... reads a datetime-local value in the phone\'s zone and refuses anything else', () => {
    expect(untilFromLocal('2026-10-04T18:30')).toBe(secs(at(2026, 10, 4, 18, 30)));
    expect(untilFromLocal('')).toBeUndefined();
    expect(untilFromLocal('tomorrow')).toBeUndefined();
  });
});

describe('describeUntil', () => {
  it('is the weekday and the 24-hour time', () => {
    expect(describeUntil(secs(at(2026, 10, 4, 21)))).toBe('Sun 21:00');
    expect(describeUntil(secs(at(2026, 10, 2, 7, 5)))).toBe('Fri 07:05');
  });
});

describe('stateAt', () => {
  it('reads a kept on whose end has passed as off', () => {
    const on = { on: true, until: 100, by: 'until' as const };
    expect(stateAt(on, 99_000)).toBe(on);
    expect(stateAt(on, 100_000)).toEqual({ on: false, until: 0, by: '' });
  });
});

describe('the schedule draft', () => {
  const setting = { until: 0, reaches: {} };

  it('starts empty on 09:00 to 21:00 and asks for a day', () => {
    const draft = draftOf(setting);
    expect(draft).toEqual({ days: [], from: '09:00', to: '21:00' });
    expect(draftProblem(draft)).toMatch(/at least one day/);
    expect(draftProblem({ ...draft, days: ['sun'] })).toBeUndefined();
    expect(draftProblem({ days: ['sun'], from: '09:00', to: '09:00' })).toMatch(/must differ/);
  });

  it('is sent as the first window, in the given zone, keeping other windows', () => {
    const extra = { days: ['fri' as const], from: '21:00', to: '07:00' };
    const kept = { ...setting, schedule: { tz: 'Europe/Paris', windows: [{ days: ['mon' as const], from: '08:00', to: '09:00' }, extra] } };
    const next = withSchedule(kept, { days: ['sun'], from: '09:00', to: '21:00' }, 'America/Chicago');
    expect(next.schedule).toEqual({ tz: 'America/Chicago', windows: [{ days: ['sun'], from: '09:00', to: '21:00' }, extra] });
    expect(withoutSchedule(next).schedule).toBeUndefined();
  });
});

describe('readAnswer', () => {
  it('reads {setting, state} and refuses what is not one', () => {
    expect(readAnswer({ setting: { until: 5, reaches: { ring: false } }, state: { on: true, until: 5, by: 'schedule' } })).toMatchObject({
      setting: { until: 5, reaches: { ring: false } },
      state: { on: true, until: 5, by: 'schedule' },
    });
    expect(readAnswer({})).toBeUndefined();
    expect(readAnswer('x')).toBeUndefined();
    expect(readAnswer({ setting: {}, state: { on: 'yes' } })).toBeUndefined();
  });
});
