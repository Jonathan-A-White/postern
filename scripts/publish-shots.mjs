#!/usr/bin/env node
// scripts/publish-shots.mjs — mw-eqhpw.1: rsyncs `npm run shots`'s output to
// the postern VPS under /var/www/postern-shots/<story-id>/, trims that
// directory to the newest 30 story sets, and prints an https URL for each
// published screenshot. Run with `npm run shots:publish -- <story-id>`.
//
// mw-s6387p.1: `npm run shots:publish -- latest` publishes the one fixed set another team
// fetches: the shots (test-results/shots/<size>/<name>.png) plus index.html and manifest.json,
// to /var/www/postern-shots/latest/ on the VPS and as one new commit on the orphan 'shots'
// branch of Jonathan-A-White/postern (pushed without force). The trim never touches latest/.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIndexHtml, buildManifest, shouldCommit, stabiliseManifest } from './shots-gallery.mjs';

const REMOTE_HOST = 'root@allmymind.org';
const REMOTE_BASE = '/var/www/postern-shots';
const KEEP_COUNT = 30;
const SOURCE_DIR = 'test-results/shots';
const STORY_ID_PATTERN = /^mw-[a-z0-9.]+$/;
const LATEST = 'latest';
const PUBLIC_BASE = 'https://postern.allmymind.org/shots';
const SHOTS_BRANCH = 'shots';
const SCRATCH_BRANCH = '_postern-shots-publish';

// Every png under dir, as a path relative to it with '/' separators, sorted.
function listPngs(dir, prefix = '') {
  const found = [];
  let entries;
  try {
    entries = readdirSync(path.join(dir, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' && !prefix) return found;
    throw error;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listPngs(dir, rel));
    else if (entry.name.endsWith('.png')) found.push(rel);
  }
  return found.sort();
}

function rsyncTo(sourceDir, destination) {
  execFileSync('rsync', ['-az', '--delete', '--chmod=D755,F644', '-e', 'ssh -o BatchMode=yes', `${sourceDir}/`, destination], {
    stdio: 'inherit',
  });
}

// Keeps the newest KEEP_COUNT story sets; latest/ is not a story set and is never removed.
function trimRemote() {
  const trimCommand = [
    `cd ${REMOTE_BASE}`,
    `ls -1dt */ 2>/dev/null | grep -v '^${LATEST}/$' | tail -n +${KEEP_COUNT + 1} | sed 's:/$::' | xargs -r rm -rf --`,
  ].join(' && ');
  execFileSync('ssh', ['-o', 'BatchMode=yes', REMOTE_HOST, trimCommand], { stdio: 'inherit' });
}

function publishStory(storyId, sourceDir) {
  rsyncTo(sourceDir, `${REMOTE_HOST}:${REMOTE_BASE}/${storyId}/`);
  trimRemote();
  for (const name of listPngs(sourceDir)) {
    console.log(`${PUBLIC_BASE}/${storyId}/${name}`);
  }
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

// What the shots branch holds now: its tip and manifest.json, or null for a branch not yet made.
// Throws if GitHub cannot be reached, so an outage is not mistaken for a first publish.
function readShotsBranch(cwd) {
  const listed = git(cwd, 'ls-remote', '--heads', 'origin', SHOTS_BRANCH).trim();
  if (!listed) return null;
  git(cwd, 'fetch', '--quiet', 'origin', `refs/heads/${SHOTS_BRANCH}`);
  const tip = git(cwd, 'rev-parse', 'FETCH_HEAD').trim();
  return { tip, manifestText: tryGit(cwd, 'show', `${tip}:${LATEST}/manifest.json`) };
}

// One new commit replacing latest/ on the shots branch, made in a temporary worktree and pushed
// without force; no commit when no file changed.
function commitToShotsBranch(cwd, stagingDir, tip, message) {
  const worktree = mkdtempSync(path.join(os.tmpdir(), 'postern-shots-branch-'));
  let scratchBranch = false;
  try {
    git(cwd, 'worktree', 'add', '--quiet', '--detach', worktree, tip ?? 'HEAD');
    if (!tip) {
      git(worktree, 'checkout', '--quiet', '--orphan', SCRATCH_BRANCH);
      scratchBranch = true;
      git(worktree, 'rm', '-rf', '--quiet', '.');
    }
    rmSync(path.join(worktree, LATEST), { recursive: true, force: true });
    cpSync(stagingDir, path.join(worktree, LATEST), { recursive: true });
    git(worktree, 'add', '-A');
    if (!shouldCommit(git(worktree, 'status', '--porcelain'))) {
      console.log(`The ${SHOTS_BRANCH} branch already holds this set: nothing to commit.`);
      return false;
    }
    git(worktree, 'commit', '--quiet', '-m', message);
    git(worktree, 'push', '--quiet', 'origin', `HEAD:refs/heads/${SHOTS_BRANCH}`);
    console.log(`Pushed one commit to the ${SHOTS_BRANCH} branch.`);
    return true;
  } finally {
    tryGit(cwd, 'worktree', 'remove', '--force', worktree);
    rmSync(worktree, { recursive: true, force: true });
    tryGit(cwd, 'worktree', 'prune');
    if (scratchBranch) tryGit(cwd, 'branch', '-D', SCRATCH_BRANCH);
  }
}

function publishLatest(sourceDir) {
  const cwd = process.cwd();
  const names = listPngs(sourceDir);
  if (names.length === 0) {
    console.error(`Refusing: no shots in ${SOURCE_DIR}; run npm run shots first.`);
    process.exitCode = 1;
    return;
  }
  const version = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf-8')).version;
  const commit = (tryGit(cwd, 'rev-parse', '--short', 'HEAD') ?? 'dev').trim();

  let branch = null;
  let branchError = null;
  try {
    branch = readShotsBranch(cwd);
  } catch (error) {
    branchError = error;
  }

  const manifest = stabiliseManifest(
    buildManifest({ names, version, commit, publishedAt: new Date().toISOString() }),
    branch?.manifestText,
  );
  const stagingDir = mkdtempSync(path.join(os.tmpdir(), 'postern-shots-latest-'));
  try {
    chmodSync(stagingDir, 0o755);
    cpSync(sourceDir, stagingDir, { recursive: true });
    writeFileSync(path.join(stagingDir, 'index.html'), buildIndexHtml({ names, version }));
    writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    rsyncTo(stagingDir, `${REMOTE_HOST}:${REMOTE_BASE}/${LATEST}/`);
    trimRemote();
    console.log(`${PUBLIC_BASE}/${LATEST}/`);
    console.log(`${PUBLIC_BASE}/${LATEST}/manifest.json  (${manifest.files.length} files, version ${version})`);

    if (branchError) throw branchError;
    commitToShotsBranch(cwd, stagingDir, branch?.tip ?? null, `Shots ${version} (${commit})`);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function main() {
  const storyId = process.argv[2];
  const isLatest = storyId === LATEST;
  if (!storyId || (!isLatest && !STORY_ID_PATTERN.test(storyId))) {
    console.error(
      `Refusing: pass a story id matching ${STORY_ID_PATTERN}, e.g. npm run shots:publish -- mw-eqhpw.1, or "${LATEST}" for the fixed set`,
    );
    process.exitCode = 1;
    return;
  }

  const sourceDir = path.join(process.cwd(), SOURCE_DIR);
  if (isLatest) publishLatest(sourceDir);
  else publishStory(storyId, sourceDir);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
