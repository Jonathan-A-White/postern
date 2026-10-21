import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { playwrightTimeouts, vitestTimeouts } from 'pwa-kit/test-preset';

// The landing gate runs the whole suite on a loaded host. testing-library's default 1 s
// waitFor/findBy timeout flaked three screens in one day (mw-gq6.212), and the 5 s that replaced it
// failed the cockpit's 'When the cockpit opens' step after 8.7 s on 2026-10-15 (mw-40qzg4.1). A wait
// only spends its budget when the thing never comes, so the budget is generous: 20 s, and the
// raise lives in tests/setup.ts so no single file has to remember it.
const BUDGET_MS = 20_000;

function numberOf(text: string | undefined): number {
  return Number((text ?? '').replace(/_/g, ''));
}

function filesUnder(dir: string, suffix: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full, suffix);
    return suffix.test(entry.name) ? [full] : [];
  });
}

// Waits on a real clock that stay short on purpose: the wait IS the claim being tested.
const DELIBERATE: Record<string, string> = {
  // 'within 4 seconds the screen says ...': bsv-kit's three-second give-up, bounded by the scenario's own words.
  'features/steps/talk-screen.steps.tsx': 'timeout: 4000',
  // Puts Testing Library's own 1 s back to prove a key arriving 1.2 s late is waited for (mw-ezzapm).
  'features/steps/last-route.steps.tsx': 'asyncUtilTimeout: 1000',
};

describe('tests/setup.ts', () => {
  it('raises testing-library asyncUtilTimeout to 20 s for every test file', () => {
    expect(getConfig().asyncUtilTimeout).toBe(BUDGET_MS);
  });

  // Both configs take their numbers from pwa-kit/test-preset (mw-gq6.679): read that they spread it, and what it holds.
  // (The config itself is not imported: this file runs in jsdom, where esbuild refuses to load.)
  it('keeps vitest testTimeout above asyncUtilTimeout, so a wait spends its whole budget before the test dies', () => {
    expect(readFileSync('vitest.config.ts', 'utf-8')).toMatch(/\.\.\.vitestTimeouts/);
    expect(vitestTimeouts.testTimeout).toBeGreaterThanOrEqual(BUDGET_MS * 2);
  });

  it("gives playwright's expect() the same 20 s, so an e2e spec does not fail on the 5 s default", () => {
    expect(readFileSync('playwright.config.ts', 'utf-8')).toMatch(/\.\.\.playwrightTimeouts/);
    expect(playwrightTimeouts.expect.timeout).toBeGreaterThanOrEqual(BUDGET_MS);
  });

  it('has no step file, unit test or e2e spec waiting on a real clock for less than 20 s', () => {
    const short: string[] = [];
    const files = [
      ...filesUnder('features/steps', /\.tsx?$/),
      ...filesUnder('tests/unit', /\.tsx?$/),
      ...filesUnder('tests/e2e', /\.tsx?$/),
      ...filesUnder('tests/support', /\.tsx?$/),
    ].filter((file) => file !== path.join('tests', 'unit', 'test-setup.test.ts'));
    for (const file of files) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(/\b(asyncUtilTimeout|timeout|SLOW_HOST_MS)(?::|\s*=)\s*([\d_]+)/g)) {
            if (numberOf(match[2]) >= BUDGET_MS || numberOf(match[2]) === 0) continue;
            if (DELIBERATE[file.split(path.sep).join('/')] === match[0].replace(/\s*=\s*/, ': ')) continue;
            short.push(`${file}:${index + 1}: ${match[0]}`);
          }
        });
    }
    expect(short).toEqual([]);
  });
});
