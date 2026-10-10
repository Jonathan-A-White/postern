// tests/unit/changelog-backfill.test.ts — mw-3g87px: 0.5.19 to 0.5.23 landed with no changelog line; each now has
// exactly one entry in public/changelog.json and in CHANGELOG.md, and the json stays newest first.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Entry { version: string; date: string; story: string; kind: 'new' | 'fixed'; text: string }

const entries = JSON.parse(readFileSync('public/changelog.json', 'utf8')) as Entry[];
const markdown = readFileSync('CHANGELOG.md', 'utf8');

const BACKFILLED: Record<string, string> = {
  '0.5.19': 'mw-7m3136.1',
  '0.5.20': 'mw-jtzpw0.8',
  '0.5.21': 'mw-m7v5kc.2',
  '0.5.22': 'mw-lcirxg',
  '0.5.23': 'mw-vtjxh4.29',
};

const asNumbers = (v: string) => v.split('.').map(Number);
const newerFirst = (a: string, b: string) => {
  const [x, y] = [asNumbers(a), asNumbers(b)];
  return x.findIndex((n, i) => n !== y[i]) < 0 ? 0 : x[x.findIndex((n, i) => n !== y[i])] > y[x.findIndex((n, i) => n !== y[i])] ? -1 : 1;
};

describe('the changelog backfill for 0.5.19 to 0.5.23', () => {
  for (const [version, story] of Object.entries(BACKFILLED)) {
    it(`${version} has one entry in public/changelog.json with its story, a date, a kind and a sentence`, () => {
      const mine = entries.filter((e) => e.version === version);
      expect(mine).toHaveLength(1);
      expect(mine[0].story).toBe(story);
      expect(mine[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['new', 'fixed']).toContain(mine[0].kind);
      expect(mine[0].text.length).toBeGreaterThan(10);
    });

    it(`${version} has one section in CHANGELOG.md carrying the same line`, () => {
      const sections = markdown.split(/^## /m).filter((s) => s.startsWith(`${version}\n`));
      expect(sections).toHaveLength(1);
      const entry = entries.find((e) => e.version === version)!;
      expect(sections[0]).toContain(entry.date);
      expect(sections[0]).toContain(`- ${entry.kind === 'new' ? 'New' : 'Fixed'}: ${entry.text}`);
    });
  }

  it('keeps public/changelog.json and CHANGELOG.md newest first', () => {
    const versions = entries.map((e) => e.version);
    expect([...versions].sort(newerFirst)).toEqual(versions);
    const headings = [...markdown.matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
    expect([...headings].sort(newerFirst)).toEqual(headings);
  });
});
