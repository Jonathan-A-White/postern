// mw-tfne4.37: overlapping gates on the desktop starve each other — vitest's
// default maxWorkers (availableParallelism() - 1) lets four concurrent gates
// spawn 60 forks on 16 cores, and the three tests that run a real vite build
// then miss their own timeouts. This proves the worker cap and the build
// tests' longer timeouts by reading source rather than re-running vitest
// inside vitest.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('vitest.config.ts worker cap', () => {
  const source = readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf-8');

  it('caps maxWorkers at 4 so overlapping gates do not starve each other', () => {
    expect(source).toMatch(/maxWorkers:\s*4/);
  });
});

describe('real-build tests get a 120s timeout', () => {
  const buildTestFiles = [
    'tests/unit/vite-contract-decorators.test.ts',
    'tests/unit/vite-events-alias.test.ts',
    'tests/unit/pwa-precache.test.ts',
  ];

  it.each(buildTestFiles)('%s times out at 120_000ms, not its old shorter budget', (file) => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf-8');
    expect(source).toMatch(/,\s*120_000\s*\);/);
    expect(source).not.toMatch(/,\s*(30_000|20_000|60_000)\s*\);/);
  });
});
