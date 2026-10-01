import { describe, expect, it } from 'vitest';

// The clock-format tests expect UTC strings; the run must pin the zone itself
// so a plain `npm test` passes on a host in any zone (mw-f758y.36).
describe('test run time zone', () => {
  it('runs in UTC whatever zone the host is in', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
