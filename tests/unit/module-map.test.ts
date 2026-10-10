// tests/unit/module-map.test.ts — mw-vtjxh4.24: docs/module-map.md stays a true map.
// It has its five sections, every file it names in inline backticks exists (proposed new
// files are named only inside fenced blocks, so the map cannot rot silently when a file
// moves), each proposed refactor carries a typed API and a size, and the README links it.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = existsSync('docs/module-map.md') ? readFileSync('docs/module-map.md', 'utf-8') : '';

/** The text outside fenced code blocks. */
const prose = doc.replace(/```[\s\S]*?```/g, '');

/** Inline-backticked tokens that look like a repo path (a slash, or a known root file). */
function namedPaths(): string[] {
  const found = new Set<string>();
  for (const [, token] of prose.matchAll(/`([^`\n]+)`/g)) {
    if (/\s/.test(token) || /[*{}<>()=:]/.test(token)) continue;
    if (/^(src|docs|features|tests|server|public)\//.test(token) || /^[\w.-]+\.(md|json|ts|tsx|css)$/.test(token)) {
      found.add(token.replace(/[/]+$/, ''));
    }
  }
  return [...found];
}

/** The text of one `## ` section, up to the next `## `. */
function section(heading: RegExp): string {
  const parts = doc.split(/^## /m).slice(1);
  return parts.find((part) => heading.test(part.split('\n')[0].replace(/^\d+\.\s*/, ''))) ?? '';
}

describe('docs/module-map.md', () => {
  it('exists', () => {
    expect(doc.length).toBeGreaterThan(0);
  });

  it('has its five sections', () => {
    for (const heading of [/^Modules/, /^Collisions/, /^Proposed refactors/, /^Rule breaks/, /^Library candidates/]) {
      expect(section(heading), String(heading)).not.toBe('');
    }
  });

  it('names only files that exist', () => {
    const paths = namedPaths();
    expect(paths.length).toBeGreaterThan(40);
    expect(paths.filter((path) => !existsSync(path))).toEqual([]);
  });

  it('lists the fifteen most-changed source files with their line counts', () => {
    const rows = section(/^Collisions/).split('\n').filter((line) => /^\|\s*\d+\s*\|\s*`src\//.test(line));
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      const [, commits, file, lines] = row.split('|').map((cell) => cell.trim());
      expect(Number(commits)).toBeGreaterThan(0);
      expect(Number(lines)).toBeGreaterThan(0);
      expect(existsSync(file.replace(/`/g, '')), file).toBe(true);
    }
  });

  it('proposes at least three refactors, each with a typed API and a size', () => {
    const refactors = section(/^Proposed refactors/).split(/^### /m).slice(1);
    expect(refactors.length).toBeGreaterThanOrEqual(3);
    expect(refactors.length).toBeLessThanOrEqual(8);
    for (const refactor of refactors) {
      const title = refactor.split('\n')[0];
      expect(refactor, `${title}: a typed API`).toMatch(/```ts[\s\S]*?(function|interface|type|=>)[\s\S]*?```/);
      expect(refactor, `${title}: a size`).toMatch(/\*\*Size:\*\* (fits one story|does not fit one story)/);
      expect(refactor, `${title}: a risk`).toMatch(/\*\*Risk:\*\*/);
      expect(refactor, `${title}: files touched`).toMatch(/\*\*Touches:\*\*/);
    }
  });

  it('gives each library candidate a home, a public API and a versioning note', () => {
    const candidates = section(/^Library candidates/).split(/^### /m).slice(1);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const candidate of candidates) {
      const title = candidate.split('\n')[0];
      expect(candidate, `${title}: home`).toMatch(/\*\*Belongs in:\*\*/);
      expect(candidate, `${title}: API`).toMatch(/```ts/);
      expect(candidate, `${title}: versioning`).toMatch(/\*\*Versioning:\*\*/);
    }
  });

  it('is linked from the README', () => {
    expect(readFileSync('README.md', 'utf-8')).toContain('docs/module-map.md');
  });
});
