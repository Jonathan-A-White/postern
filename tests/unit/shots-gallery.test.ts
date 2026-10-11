// @vitest-environment node
//
// mw-s6387p.1: the pure parts of `npm run shots:publish -- latest`: the manifest, the gallery page,
// and the decision to commit or skip on the 'shots' branch.
import { describe, it, expect } from 'vitest';
import { SHOT_SIZES, buildIndexHtml, buildManifest, parseShotName, shouldCommit, stabiliseManifest } from '../../scripts/shots-gallery.mjs';

const THREE = (screen: string) => [`390x844/${screen}.png`, `360x640/${screen}.png`, `1280x800/${screen}.png`];

describe('SHOT_SIZES', () => {
  it('are the three sizes, phone first', () => {
    expect(SHOT_SIZES.map((s) => `${s.width}x${s.height}`)).toEqual(['390x844', '360x640', '1280x800']);
    expect(SHOT_SIZES.map((s) => s.name)).toEqual(['390x844', '360x640', '1280x800']);
  });
});

describe('parseShotName', () => {
  it('reads size and screen from <size>/<screen>.png', () => {
    expect(parseShotName('360x640/cockpit-needs.png')).toEqual({ size: '360x640', width: 360, height: 640, screen: 'cockpit-needs' });
  });

  it('refuses a name without a size folder', () => {
    expect(() => parseShotName('gate.png')).toThrow(/size/i);
    expect(() => parseShotName('abc/gate.png')).toThrow(/size/i);
  });
});

describe('buildManifest', () => {
  const manifest = buildManifest({
    names: [...THREE('gate'), ...THREE('about')],
    version: '0.5.35',
    commit: 'abc1234',
    publishedAt: '2026-10-10T12:00:00.000Z',
  });

  it('carries the version, commit and time', () => {
    expect(manifest.version).toBe('0.5.35');
    expect(manifest.commit).toBe('abc1234');
    expect(manifest.published_at).toBe('2026-10-10T12:00:00.000Z');
  });

  it('lists every png once with name, screen, width, height and url', () => {
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.find((f) => f.name === '1280x800/about.png')).toEqual({
      name: '1280x800/about.png',
      screen: 'about',
      width: 1280,
      height: 800,
      url: 'https://raw.githubusercontent.com/Jonathan-A-White/postern/shots/latest/1280x800/about.png',
    });
  });

  it('sorts files by screen, then phone, small phone, desktop', () => {
    expect(manifest.files.map((f) => f.name)).toEqual([...THREE('about'), ...THREE('gate')]);
  });

  it('survives JSON round trip', () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('percent-encodes a name in the url', () => {
    const m = buildManifest({ names: ['390x844/a b#c.png'], version: '1', commit: 'x', publishedAt: 'now' });
    expect(m.files[0].url).toBe('https://raw.githubusercontent.com/Jonathan-A-White/postern/shots/latest/390x844/a%20b%23c.png');
    expect(m.files[0].name).toBe('390x844/a b#c.png');
  });
});

describe('buildIndexHtml', () => {
  const html = buildIndexHtml({ names: [...THREE('gate'), ...THREE('about')], version: '0.5.35' });

  it('names each screen once, in order', () => {
    expect([...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(['about', 'gate']);
  });

  it('shows the three sizes of a screen side by side, each linking to the full png', () => {
    const gate = html.slice(html.indexOf('<h2>gate</h2>'));
    const order = ['390x844/gate.png', '360x640/gate.png', '1280x800/gate.png'].map((n) => gate.indexOf(`<a href="${n}">`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('links relative, not absolute', () => {
    expect(html).not.toMatch(/href="https?:/);
    expect(html).not.toMatch(/src="https?:/);
  });

  it('says the version and points at manifest.json', () => {
    expect(html).toContain('0.5.35');
    expect(html).toContain('<a href="manifest.json">');
  });

  it('escapes a name with markup, quotes and ampersands', () => {
    const evil = buildIndexHtml({ names: ['390x844/a<script>"&\'b.png'], version: '<v>' });
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<v>');
    expect(evil).toContain('a&lt;script&gt;&quot;&amp;&#39;b');
  });

  it('is a whole html page', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta name="viewport"');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });
});

describe('shouldCommit', () => {
  it('skips when git status is empty', () => {
    expect(shouldCommit('')).toBe(false);
    expect(shouldCommit('\n')).toBe(false);
  });

  it('commits when any file changed, was added or was removed', () => {
    expect(shouldCommit('M  latest/390x844/gate.png\n')).toBe(true);
    expect(shouldCommit('A  latest/manifest.json\n')).toBe(true);
    expect(shouldCommit('D  latest/old.png\n')).toBe(true);
  });
});

describe('stabiliseManifest', () => {
  const base = { names: THREE('gate'), version: '0.5.35', commit: 'abc1234' };
  const first = buildManifest({ ...base, publishedAt: '2026-10-10T12:00:00.000Z' });
  const later = buildManifest({ ...base, publishedAt: '2026-10-11T08:00:00.000Z' });

  it('keeps the old published_at when nothing else changed, so the file is the same bytes', () => {
    expect(JSON.stringify(stabiliseManifest(later, JSON.stringify(first)))).toBe(JSON.stringify(first));
  });

  it('takes the new time when the commit or the files changed', () => {
    expect(stabiliseManifest({ ...later, commit: 'def5678' }, JSON.stringify(first)).published_at).toBe(later.published_at);
    expect(stabiliseManifest(buildManifest({ ...base, names: [...THREE('gate'), ...THREE('about')], publishedAt: later.published_at }), JSON.stringify(first)).published_at).toBe(later.published_at);
  });

  it('takes the new manifest when there is no old one or it is not json', () => {
    expect(stabiliseManifest(later, null)).toBe(later);
    expect(stabiliseManifest(later, 'not json')).toBe(later);
  });
});
