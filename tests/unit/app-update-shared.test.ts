// mw-ti1qik.3: Postern takes its update state machine from pwa-kit/app-update; there is no second copy
// in src/, and Postern passes no hasNewsSince, so the quiet take-over stays off and every new build is
// offered by the banner.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAKE_OVER_PATIENCE_MS as sharedPatience } from 'pwa-kit/app-update';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the shared update state machine', () => {
  it('has no copy of its own in src/services', () => {
    expect(existsSync('src/services/appUpdate.ts')).toBe(false);
  });

  it('is the only place the take-over patience is defined', () => {
    const own = sources('src').filter((file) => /export const TAKE_OVER_PATIENCE_MS/.test(readFileSync(file, 'utf8')));
    expect(own).toEqual([]);
    expect(sharedPatience).toBe(10_000);
  });

  it('is started without hasNewsSince, so no build is taken over quietly', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toMatch(/from 'pwa-kit\/app-update'/);
    expect(main).not.toMatch(/hasNewsSince/);
  });
});
