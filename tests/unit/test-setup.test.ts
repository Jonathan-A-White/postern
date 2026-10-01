import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

// The landing gate runs the whole suite on a loaded host; testing-library's default
// 1 s waitFor/findBy timeout flaked three screens in one day (mw-gq6.212). The raise
// lives in tests/setup.ts so no single file has to remember it.
describe('tests/setup.ts', () => {
  it('raises testing-library asyncUtilTimeout to 5 s for every test file', () => {
    expect(getConfig().asyncUtilTimeout).toBe(5000);
  });

  it('keeps vitest testTimeout above asyncUtilTimeout', () => {
    const config = readFileSync('vitest.config.ts', 'utf-8');
    const match = /testTimeout:\s*([\d_]+)/.exec(config);
    expect(Number(match?.[1].replace(/_/g, ''))).toBeGreaterThan(5000);
  });
});
