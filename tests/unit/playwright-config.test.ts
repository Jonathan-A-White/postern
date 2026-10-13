// mw-eqhpw.1: `npm run shots` needs a Playwright project whose viewport is a
// 390px phone width so every e2e spec's end-of-test screenshot is taken at
// that width. Chromium isn't installed on every Builder host, so this proves
// the project exists by reading playwright.config.ts's own source rather than
// launching a browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { shotSize } from '../support/shot-size';
import { SHOT_SIZES } from '../../scripts/shots-gallery.mjs';

describe('playwright.config.ts shots project', () => {
  const source = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8');

  it('declares a project named "shots"', () => {
    expect(source).toMatch(/name:\s*['"]shots['"]/);
  });

  // mw-s6387p.1: 390x844 unless scripts/run-shots.mjs is on another of the three sizes (SHOT_SIZE).
  it('gives the shots project a 390x844 viewport unless SHOT_SIZE says another', () => {
    const projectsBlock = source.slice(source.indexOf('projects:'));
    const shotsIndex = projectsBlock.indexOf("name: 'shots'");
    expect(shotsIndex).toBeGreaterThan(-1);
    const shotsProject = projectsBlock.slice(shotsIndex, shotsIndex + 400);
    expect(shotsProject).toMatch(/viewport:\s*shotSize\(\)\s*\?\?\s*\{\s*width:\s*390,\s*height:\s*844\s*\}/);
  });
});

// mw-gq6.403: the preview server goes through scripts/preview-guard.mjs, which stops a leftover
// `vite preview` from this checkout first, so a stale one never fails a shots run.
describe('playwright.config.ts webServer', () => {
  const source = readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8');

  it('stops a leftover preview as the main process loads the config, not in the workers', () => {
    expect(source).toMatch(/TEST_WORKER_INDEX === undefined[^\n]*stopLeftoverPreview\(PREVIEW_PORT\)/);
  });

  it('starts the preview through the guard, on the strict port', () => {
    expect(source).toMatch(/command:\s*`node scripts\/preview-guard\.mjs \$\{PREVIEW_PORT\} -- npm run preview -- --port \$\{PREVIEW_PORT\} --strictPort`/);
  });
});

describe('shotSize', () => {
  it('reads SHOT_SIZE as <width>x<height>', () => {
    expect(shotSize({ SHOT_SIZE: '360x640' })).toEqual({ width: 360, height: 640 });
    expect(shotSize({ SHOT_SIZE: '1280x800' })).toEqual({ width: 1280, height: 800 });
  });

  it('is null when unset or not a size', () => {
    expect(shotSize({})).toBeNull();
    expect(shotSize({ SHOT_SIZE: 'big' })).toBeNull();
  });

  it('knows every size npm run shots runs', () => {
    for (const size of SHOT_SIZES) expect(shotSize({ SHOT_SIZE: size.name })).toEqual({ width: size.width, height: size.height });
  });
});
