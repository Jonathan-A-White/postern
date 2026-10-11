// @vitest-environment node
//
// mw-eqhpw.1: scripts/publish-shots.mjs rsyncs test-results/shots/ to the
// postern VPS and trims old story sets over ssh. There is no VPS in the test
// environment, so this installs stub `rsync` and `ssh` shell scripts on PATH
// that record their argv, then runs the real script as a child process and
// inspects what it invoked.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = path.join(process.cwd(), 'scripts', 'publish-shots.mjs');

function makeStubBin(dir: string, name: string, logFile: string): void {
  const binPath = path.join(dir, name);
  writeFileSync(binPath, ['#!/bin/sh', `printf '%s\\n' "$@" >> "${logFile}"`, 'exit 0', ''].join('\n'));
  chmodSync(binPath, 0o755);
}

function readLog(logFile: string): string[] {
  try {
    return readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('scripts/publish-shots.mjs', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup(): { cwd: string; binDir: string; rsyncLog: string; sshLog: string } {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'postern-shots-cwd-'));
    const binDir = mkdtempSync(path.join(os.tmpdir(), 'postern-shots-bin-'));
    tmpDirs.push(cwd, binDir);
    const rsyncLog = path.join(binDir, 'rsync.log');
    const sshLog = path.join(binDir, 'ssh.log');
    makeStubBin(binDir, 'rsync', rsyncLog);
    makeStubBin(binDir, 'ssh', sshLog);

    const shotsDir = path.join(cwd, 'test-results', 'shots');
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(path.join(shotsDir, 'gate.png'), 'fake-png-gate');
    writeFileSync(path.join(shotsDir, 'compose.png'), 'fake-png-compose');

    return { cwd, binDir, rsyncLog, sshLog };
  }

  function run(cwd: string, binDir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [SCRIPT, ...args], {
      cwd,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      encoding: 'utf-8',
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('refuses with no story id', () => {
    const { cwd, binDir, rsyncLog, sshLog } = setup();
    const result = run(cwd, binDir, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/story[- ]id/i);
    expect(readLog(rsyncLog)).toEqual([]);
    expect(readLog(sshLog)).toEqual([]);
  });

  it('refuses a story id that does not match mw-[a-z0-9.]+', () => {
    const { cwd, binDir, rsyncLog, sshLog } = setup();
    const result = run(cwd, binDir, ['not-a-story-id']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/story[- ]id/i);
    expect(readLog(rsyncLog)).toEqual([]);
    expect(readLog(sshLog)).toEqual([]);
  });

  it('rsyncs test-results/shots/ to the story directory on the VPS', () => {
    const { cwd, binDir, rsyncLog } = setup();
    const result = run(cwd, binDir, ['mw-eqhpw.1']);
    expect(result.status).toBe(0);
    const argv = readLog(rsyncLog);
    expect(argv).toContain('-az');
    expect(argv).toContain('--delete');
    expect(argv).toContain('-e');
    expect(argv).toContain('ssh -o BatchMode=yes');
    expect(argv).toContain(`${path.join(cwd, 'test-results', 'shots')}/`);
    expect(argv).toContain('root@allmymind.org:/var/www/postern-shots/mw-eqhpw.1/');
  });

  it('trims the remote directory to the newest 30 story sets over ssh', () => {
    const { cwd, binDir, sshLog } = setup();
    const result = run(cwd, binDir, ['mw-eqhpw.1']);
    expect(result.status).toBe(0);
    const argv = readLog(sshLog);
    expect(argv).toContain('-o');
    expect(argv).toContain('BatchMode=yes');
    expect(argv).toContain('root@allmymind.org');
    const remoteCommand = argv[argv.length - 1];
    expect(remoteCommand).toContain('/var/www/postern-shots');
    expect(remoteCommand).toContain('tail -n +31');
  });

  it('prints one URL per screenshot', () => {
    const { cwd, binDir } = setup();
    const result = run(cwd, binDir, ['mw-eqhpw.1']);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toContain('https://postern.allmymind.org/shots/mw-eqhpw.1/gate.png');
    expect(lines).toContain('https://postern.allmymind.org/shots/mw-eqhpw.1/compose.png');
  });
});

// mw-s6387p.1: `latest` is the one fixed set: shots in <size>/ folders plus index.html and
// manifest.json, rsynced to /shots/latest/ and committed to the orphan 'shots' branch.
// git here is real (against a bare repo standing in for GitHub), wrapped to log its argv;
// rsync and ssh are stubs.
describe('scripts/publish-shots.mjs -- latest', () => {
  const tmpDirs: string[] = [];
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).trim();
  const gitEnv = {
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_TERMINAL_PROMPT: '0',
  };

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(realGit, args, { cwd, encoding: 'utf-8', env: { ...process.env, ...gitEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  function setup() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'postern-latest-'));
    tmpDirs.push(root);
    const bare = path.join(root, 'origin.git');
    const cwd = path.join(root, 'work');
    const binDir = path.join(root, 'bin');
    mkdirSync(binDir);
    mkdirSync(cwd);
    git(root, 'init', '--bare', '-b', 'main', bare);
    git(cwd, 'init', '-b', 'main');
    git(cwd, 'remote', 'add', 'origin', bare);
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'postern', version: '9.8.7' }));
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-m', 'first');
    git(cwd, 'push', 'origin', 'main');

    const rsyncLog = path.join(binDir, 'rsync.log');
    const sshLog = path.join(binDir, 'ssh.log');
    const gitLog = path.join(binDir, 'git.log');
    const rsyncCopy = path.join(binDir, 'rsync-src');
    // rsync stub: logs argv and keeps a copy of the source directory (the second-to-last argument).
    writeFileSync(
      path.join(binDir, 'rsync'),
      ['#!/bin/sh', `printf '%s\\n' "$@" >> "${rsyncLog}"`, 'for a in "$@"; do prev="$last"; last="$a"; done', `rm -rf "${rsyncCopy}"; cp -r "$prev" "${rsyncCopy}"`, 'exit 0', ''].join('\n'),
    );
    chmodSync(path.join(binDir, 'rsync'), 0o755);
    makeStubBin(binDir, 'ssh', sshLog);
    writeFileSync(path.join(binDir, 'git'), ['#!/bin/sh', `printf '%s\\n' "$*" >> "${gitLog}"`, `exec "${realGit}" "$@"`, ''].join('\n'));
    chmodSync(path.join(binDir, 'git'), 0o755);

    const shotsDir = path.join(cwd, 'test-results', 'shots');
    return { root, bare, cwd, binDir, shotsDir, rsyncLog, sshLog, gitLog, rsyncCopy };
  }

  function writeShots(shotsDir: string, files: Record<string, string>): void {
    rmSync(shotsDir, { recursive: true, force: true });
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(shotsDir, name)), { recursive: true });
      writeFileSync(path.join(shotsDir, name), content);
    }
  }

  const BASE = { '390x844/gate.png': 'g1', '360x640/gate.png': 'g2', '1280x800/gate.png': 'g3' };

  function runLatest(cwd: string, binDir: string) {
    const result = spawnSync('node', [SCRIPT, 'latest'], {
      cwd,
      env: { ...process.env, ...gitEnv, PATH: `${binDir}:${process.env.PATH}` },
      encoding: 'utf-8',
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function showOnShots(bare: string, file: string): string {
    return git(bare, 'show', `shots:${file}`);
  }

  it('rsyncs a staged copy with --delete to /var/www/postern-shots/latest/, holding the shots, index.html and manifest.json', () => {
    const { cwd, binDir, shotsDir, rsyncLog, rsyncCopy } = setup();
    writeShots(shotsDir, BASE);
    const result = runLatest(cwd, binDir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const argv = readLog(rsyncLog);
    expect(argv).toContain('--delete');
    expect(argv).toContain('root@allmymind.org:/var/www/postern-shots/latest/');
    expect(existsSync(path.join(rsyncCopy, '390x844', 'gate.png'))).toBe(true);
    expect(existsSync(path.join(rsyncCopy, '1280x800', 'gate.png'))).toBe(true);
    expect(readFileSync(path.join(rsyncCopy, 'index.html'), 'utf-8')).toContain('<h2>gate</h2>');
    const manifest = JSON.parse(readFileSync(path.join(rsyncCopy, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe('9.8.7');
    expect(manifest.files).toHaveLength(3);
    // test-results/shots itself is left as the specs wrote it.
    expect(existsSync(path.join(shotsDir, 'manifest.json'))).toBe(false);
  });

  it('keeps latest/ out of the keep-30 trim', () => {
    const { cwd, binDir, shotsDir, sshLog } = setup();
    writeShots(shotsDir, BASE);
    runLatest(cwd, binDir);
    const argv = readLog(sshLog);
    const remoteCommand = argv[argv.length - 1];
    expect(remoteCommand).toContain('tail -n +31');
    expect(remoteCommand).toMatch(/grep -v .*latest/);
  });

  it('commits the set to a new orphan branch shots on the first publish, and pushes it', () => {
    const { bare, cwd, binDir, shotsDir } = setup();
    writeShots(shotsDir, BASE);
    expect(runLatest(cwd, binDir).status).toBe(0);
    expect(git(bare, 'rev-list', '--count', 'shots').trim()).toBe('1');
    expect(git(bare, 'rev-list', '--max-parents=0', 'shots').trim()).not.toBe(git(bare, 'rev-list', '--max-parents=0', 'main').trim());
    expect(git(bare, 'ls-tree', '-r', '--name-only', 'shots').trim().split('\n')).toEqual([
      'latest/1280x800/gate.png',
      'latest/360x640/gate.png',
      'latest/390x844/gate.png',
      'latest/index.html',
      'latest/manifest.json',
    ]);
    expect(showOnShots(bare, 'latest/390x844/gate.png')).toBe('g1');
    expect(JSON.parse(showOnShots(bare, 'latest/manifest.json')).files[0].url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/Jonathan-A-White\/postern\/shots\/latest\//,
    );
  });

  it('adds no commit when nothing changed', () => {
    const { bare, cwd, binDir, shotsDir } = setup();
    writeShots(shotsDir, BASE);
    runLatest(cwd, binDir);
    const head = git(bare, 'rev-parse', 'shots').trim();
    writeShots(shotsDir, BASE);
    const second = runLatest(cwd, binDir);
    expect(second.status).toBe(0);
    expect(git(bare, 'rev-parse', 'shots').trim()).toBe(head);
  });

  it('adds one commit on top, replacing latest/, when a shot changed or went away', () => {
    const { bare, cwd, binDir, shotsDir } = setup();
    writeShots(shotsDir, { ...BASE, '390x844/old.png': 'o' });
    runLatest(cwd, binDir);
    const first = git(bare, 'rev-parse', 'shots').trim();
    writeShots(shotsDir, { ...BASE, '390x844/gate.png': 'g1-new' });
    expect(runLatest(cwd, binDir).status).toBe(0);
    expect(git(bare, 'rev-list', '--count', 'shots').trim()).toBe('2');
    expect(git(bare, 'rev-parse', 'shots~1').trim()).toBe(first);
    expect(showOnShots(bare, 'latest/390x844/gate.png')).toBe('g1-new');
    expect(git(bare, 'ls-tree', '-r', '--name-only', 'shots')).not.toContain('old.png');
  });

  it('never forces the push, and leaves no worktree or branch behind', () => {
    const { cwd, binDir, shotsDir, gitLog } = setup();
    writeShots(shotsDir, BASE);
    runLatest(cwd, binDir);
    const pushes = readLog(gitLog).filter((line) => /^push\b/.test(line));
    expect(pushes.length).toBeGreaterThan(0);
    for (const line of pushes) {
      expect(line).not.toMatch(/--force|-f\b|--force-with-lease/);
      expect(line.split(' ').some((word) => word.startsWith('+'))).toBe(false);
    }
    expect(git(cwd, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
    expect(git(cwd, 'branch', '--list').trim()).toBe('* main');
  });

  it('a story id publishes as before and does not touch git', () => {
    const { cwd, binDir, shotsDir, gitLog, rsyncLog } = setup();
    writeShots(shotsDir, { 'gate.png': 'x' });
    const result = spawnSync('node', [SCRIPT, 'mw-abc.1'], { cwd, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }, encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(readLog(rsyncLog)).toContain('root@allmymind.org:/var/www/postern-shots/mw-abc.1/');
    expect(readLog(gitLog)).toEqual([]);
    expect(result.stdout).toContain('https://postern.allmymind.org/shots/mw-abc.1/gate.png');
  });

  it('refuses latest when there are no shots', () => {
    const { cwd, binDir, rsyncLog } = setup();
    const result = runLatest(cwd, binDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no shots/i);
    expect(readLog(rsyncLog)).toEqual([]);
  });
});
