// Pin the zone for the whole run, before any worker starts, so the clock-format
// tests (which expect UTC strings) pass on a host in any zone (mw-f758y.36).
export default function setup(): void {
  process.env.TZ = 'UTC';
}
