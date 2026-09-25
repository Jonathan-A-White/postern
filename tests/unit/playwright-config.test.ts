// mw-eqhpw.1: `npm run shots` needs a Playwright project whose viewport is a
// 390px phone width so every e2e spec's end-of-test screenshot is taken at
// that width. Chromium isn't installed on every Builder host, so this proves
// the project exists by reading playwright.config.ts's own source rather than
// launching a browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('playwright.config.ts shots project', () => {
  const source = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8');

  it('declares a project named "shots"', () => {
    expect(source).toMatch(/name:\s*['"]shots['"]/);
  });

  it('gives the shots project a 390x844 viewport', () => {
    const projectsBlock = source.slice(source.indexOf('projects:'));
    const shotsIndex = projectsBlock.indexOf("name: 'shots'");
    expect(shotsIndex).toBeGreaterThan(-1);
    const shotsProject = projectsBlock.slice(shotsIndex, shotsIndex + 400);
    expect(shotsProject).toMatch(/viewport:\s*\{\s*width:\s*390,\s*height:\s*844\s*\}/);
  });
});
