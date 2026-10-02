import { vi } from 'vitest';

/** The day the step files' fixtures are written on (their times are 2026-10-01 11:00-12:05Z). */
export const FIXTURE_NOW = '2026-10-01T12:30:00Z';

/**
 * Freeze only Date at the fixtures' day, so a time shown as "Answered: X 12:02 PM" does not turn into a
 * weekday or a date as the real clock moves on. Timers stay real (waitFor and timeouts keep working).
 */
export function freezeClock(now: string = FIXTURE_NOW): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
}

export function thawClock(): void {
  vi.useRealTimers();
}
