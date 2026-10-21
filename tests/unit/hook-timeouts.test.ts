// @vitest-environment node
// mw-gq6.679: a hook that removes a vite build's output (or builds, or spawns a child) outran vitest's 10 s
// default on a loaded host and failed a whole run (lampas, mw-5r3p30.420). The rig takes pwa-kit/test-preset's
// hookTimeout, so a new hook is covered without a number of its own, and the three afterAll hooks that remove
// a build's output name the preset's number besides. Read from source and config, not by re-running vitest.
import { describe, it, expect } from 'vitest';
import { HOOK_TIMEOUT_MS, vitestTimeouts } from 'pwa-kit/test-preset';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf-8');

describe('vitest.config.ts hook timeout', () => {
  it('takes the preset, so its hookTimeout is the preset\'s', async () => {
    const config = (await import('../../vitest.config')).default as unknown as { test?: { hookTimeout?: number } };
    expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(HOOK_TIMEOUT_MS);
    expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(vitestTimeouts.hookTimeout);
  });

  it('names hookTimeout through the preset, not a number of its own', () => {
    expect(read('vitest.config.ts')).toMatch(/from 'pwa-kit\/test-preset'/);
    expect(read('vitest.config.ts')).toMatch(/hookTimeout/);
  });
});

describe('the afterAll hooks that remove a build\'s output carry the preset\'s timeout', () => {
  const files = [
    'tests/unit/pwa-precache.test.ts',
    'tests/unit/vite-events-alias.test.ts',
    'tests/unit/vite-contract-decorators.test.ts',
  ];

  it.each(files)('%s: its afterAll(rmSync…) ends with HOOK_TIMEOUT_MS', (file) => {
    const source = read(file);
    expect(source).toMatch(/import\s*\{[^}]*\bHOOK_TIMEOUT_MS\b[^}]*\}\s*from\s*'pwa-kit\/test-preset'/);
    expect(source).toMatch(/afterAll\(\(\) => \{\s*rmSync\([^)]*\);\s*\}, HOOK_TIMEOUT_MS\);/);
  });
});
