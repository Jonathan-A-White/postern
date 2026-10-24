#!/usr/bin/env node
// scripts/gate-shots-sizes.mjs — mw-pb8otc: the end of `npm run gate:shots`. The gate runs the
// shots project at 390x844 only, while the run after landing (scripts/run-shots.mjs) runs every
// spec at 390x844, 360x640 and 1280x800, so a spec that holds at one layout only was found after
// landing (mw-6yhrp1). This runs the e2e specs the branch changed at the two other sizes, and
// nothing when it changed none. The pure parts are exported so tests/unit/gate-shots-sizes.test.ts
// reads them without running a browser.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SHOT_SIZES } from './shots-gallery.mjs';

const SPEC = /^tests\/e2e\/[^/]+\.spec\.ts$/;

// The e2e specs among the changed files that are still on disk, sorted, once each.
export function changedSpecs(files, exists = existsSync) {
  return [...new Set(files.filter((f) => SPEC.test(f)))].sort().filter((f) => exists(f));
}

// Every size but the first: the gate's own run is at SHOT_SIZES[0] (390x844).
export function extraSizes() {
  return SHOT_SIZES.slice(1);
}

export function planExtraRuns(specs) {
  if (specs.length === 0) return [];
  return extraSizes().map((size) => ({ size: size.name, specs }));
}

export function noExtraRunLine() {
  return `gate:shots: no e2e spec changed on this branch, so the shots ran at ${SHOT_SIZES[0].name} only`;
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The files the branch changed against its merge base, committed or not: of the target branch
// candidates (origin/main, main) the merge base nearest HEAD, since either may lag the other.
export function changedFiles() {
  let best = null;
  for (const ref of [process.env.GATE_SHOTS_BASE, 'origin/main', 'main'].filter(Boolean)) {
    const base = git(['merge-base', 'HEAD', ref]);
    if (!base) continue;
    const behind = Number(git(['rev-list', '--count', `${base}..HEAD`]));
    if (best === null || behind < best.behind) best = { base, behind };
  }
  if (best === null) throw new Error('gate-shots-sizes: no merge base with origin/main or main');
  const tracked = git(['diff', '--name-only', best.base]) ?? '';
  const untracked = git(['ls-files', '--others', '--exclude-standard']) ?? '';
  return `${tracked}\n${untracked}`.split('\n').filter(Boolean);
}

function main() {
  const specs = changedSpecs(changedFiles());
  const plan = planExtraRuns(specs);
  if (plan.length === 0) {
    console.log(noExtraRunLine());
    return 0;
  }
  let failed = 0;
  for (const run of plan) {
    console.log(`\n== gate:shots, changed specs at ${run.size}: ${run.specs.join(', ')} ==`);
    const result = spawnSync('npx', ['playwright', 'test', '--project=shots', `--output=test-results/gate-${run.size}`, ...run.specs], {
      stdio: 'inherit',
      env: { ...process.env, SHOT_SIZE: run.size },
    });
    if (result.status !== 0) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
