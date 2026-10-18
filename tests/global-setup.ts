// Pin the zone for the whole run, before any worker starts, so the clock-format
// tests (which expect UTC strings) pass on a host in any zone (mw-f758y.36).
export default function setup(): void {
  process.env.TZ = 'UTC';
  // TEST_CLOCK_AT=2026-10-17T23:59:50Z npm test runs every worker on a clock that reads that instant now
  // and keeps ticking, so a run can cross midnight on purpose (tests/support/shift-clock.ts; mw-ev7oyy.44).
  // The shift is fixed once here, so no worker starts later than another.
  const at = process.env.TEST_CLOCK_AT;
  if (at !== undefined && at !== '') {
    const target = Date.parse(at);
    if (Number.isNaN(target)) throw new Error(`TEST_CLOCK_AT is not a date: ${at}`);
    process.env.TEST_CLOCK_OFFSET_MS = String(target - Date.now());
  }
}
