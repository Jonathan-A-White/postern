#!/usr/bin/env node
// scripts/run-shots.mjs — mw-s6387p.1: `npm run shots`. Runs the 'shots' Playwright project once
// per size (SHOT_SIZES: 390x844, 360x640, 1280x800), each run with SHOT_SIZE set so every spec
// opens at that size (tests/e2e/shot.ts), and leaves test-results/shots/<size>/<name>.png.
// Extra arguments (a spec file, --grep) go to every run. Exits non-zero if any run failed, after
// all three have run.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { SHOT_SIZES } from './shots-gallery.mjs';

rmSync('test-results/shots', { recursive: true, force: true });

let failed = 0;
for (const size of SHOT_SIZES) {
  console.log(`\n== shots at ${size.name} ==`);
  // Playwright empties its output folder at the start of a run; each size has its own, so the
  // shots written by the earlier runs (test-results/shots) stay.
  const result = spawnSync('npx', ['playwright', 'test', '--project=shots', `--output=test-results/run-${size.name}`, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SHOT_SIZE: size.name },
  });
  if (result.status !== 0) failed += 1;
}
process.exitCode = failed === 0 ? 0 : 1;
