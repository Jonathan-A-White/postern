// @vitest-environment node
//
// mw-7dige5.3: the build stamp is carried by the page (index.html), not by a chunk of code, so a build whose
// code is unchanged leaves the main chunk's bytes alone. buildStampPlugin writes it; POSTERN_BUILD_AT fixes
// the build time for a reproducible build.
import { describe, it, expect, afterEach } from 'vitest';
import { buildStampAt, buildStampHtml } from '../../build-version';

afterEach(() => {
  delete process.env.POSTERN_BUILD_AT;
});

describe('buildStampAt', () => {
  it('is the time POSTERN_BUILD_AT names', () => {
    process.env.POSTERN_BUILD_AT = '2026-10-02T11:30:00Z';
    expect(buildStampAt().toISOString()).toBe('2026-10-02T11:30:00.000Z');
  });

  it('is now when it is unset or not a time', () => {
    const before = Date.now();
    expect(buildStampAt().getTime()).toBeGreaterThanOrEqual(before);
    process.env.POSTERN_BUILD_AT = 'nonsense';
    expect(Number.isNaN(buildStampAt().getTime())).toBe(false);
  });
});

describe('buildStampHtml', () => {
  it('sets window.__APP_VERSION__ to the version string, safe inside a script tag', () => {
    const html = buildStampHtml('0.6.5 · 2026-10-02 11:30Z · abc1234');
    expect(html).toBe('window.__APP_VERSION__="0.6.5 · 2026-10-02 11:30Z · abc1234";');
    expect(buildStampHtml('a</script><b')).not.toContain('</script');
  });
});
