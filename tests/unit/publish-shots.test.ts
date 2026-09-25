// @vitest-environment node
//
// mw-eqhpw.1: scripts/publish-shots.mjs rsyncs test-results/shots/ to the
// postern VPS and trims old story sets over ssh. There is no VPS in the test
// environment, so this installs stub `rsync` and `ssh` shell scripts on PATH
// that record their argv, then runs the real script as a child process and
// inspects what it invoked.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'node:fs';
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
