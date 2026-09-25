#!/usr/bin/env node
// scripts/publish-shots.mjs — mw-eqhpw.1: rsyncs `npm run shots`'s output to
// the postern VPS under /var/www/postern-shots/<story-id>/, trims that
// directory to the newest 30 story sets, and prints an https URL for each
// published screenshot. Run with `npm run shots:publish -- <story-id>`.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const REMOTE_HOST = 'root@allmymind.org';
const REMOTE_BASE = '/var/www/postern-shots';
const KEEP_COUNT = 30;
const SOURCE_DIR = 'test-results/shots';
const STORY_ID_PATTERN = /^mw-[a-z0-9.]+$/;

function main() {
  const storyId = process.argv[2];
  if (!storyId || !STORY_ID_PATTERN.test(storyId)) {
    console.error(`Refusing: pass a story id matching ${STORY_ID_PATTERN}, e.g. npm run shots:publish -- mw-eqhpw.1`);
    process.exitCode = 1;
    return;
  }

  const sourceDir = path.join(process.cwd(), SOURCE_DIR);
  const destination = `${REMOTE_HOST}:${REMOTE_BASE}/${storyId}/`;

  execFileSync('rsync', ['-az', '--delete', '-e', 'ssh -o BatchMode=yes', `${sourceDir}/`, destination], {
    stdio: 'inherit',
  });

  const trimCommand = [
    `cd ${REMOTE_BASE}`,
    "ls -1dt */ 2>/dev/null | tail -n +" + (KEEP_COUNT + 1) + " | sed 's:/$::' | xargs -r rm -rf --",
  ].join(' && ');
  execFileSync('ssh', ['-o', 'BatchMode=yes', REMOTE_HOST, trimCommand], { stdio: 'inherit' });

  const names = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.png'))
    .sort();
  for (const name of names) {
    console.log(`https://postern.allmymind.org/shots/${storyId}/${name}`);
  }
}

main();
