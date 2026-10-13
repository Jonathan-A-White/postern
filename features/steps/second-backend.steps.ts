// @vitest-environment node
//
// features/steps/second-backend.steps.ts — runs features/second-backend.feature under vitest via
// @amiceli/vitest-cucumber: the real `postern` binary (built once from server/), `postern setup` into
// temp homes with a stand-in systemctl on PATH, and two real backends started from the env files it
// wrote (mw-9rp4hu.3).
import { afterAll, beforeAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const feature = await loadFeature('features/second-backend.feature');

const ISSUER = '039d1abaec9f5715a15c7628244170951e0f85e87f68ca5393d3f9fc3fa23a69c8';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'postern-second-backend-'));
const binary = path.join(tmp, 'postern');
const bin = path.join(tmp, 'bin');
const systemctlLog = path.join(tmp, 'systemctl.log');
const children: ChildProcess[] = [];

beforeAll(async () => {
  await run('go', ['build', '-o', binary, './cmd/postern'], { cwd: path.resolve('server') });
  const stub = path.join(bin, 'systemctl');
  mkdirSync(bin);
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> ${systemctlLog}\n`);
  chmodSync(stub, 0o755);
}, 180_000);

afterAll(() => {
  for (const child of children) child.kill();
  rmSync(tmp, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function freshHome(): string {
  return mkdtempSync(path.join(tmp, 'home-'));
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

async function setup(home: string, addr: string): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(binary, ['setup', '--addr', addr, '--issuer', ISSUER], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

function envOf(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path.join(home, '.config', 'postern', 'env'), 'utf-8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#')) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

async function healthz(addr: string): Promise<number> {
  for (let i = 0; i < 100; i++) {
    try {
      return (await fetch(`http://${addr}/healthz`)).status;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return 0;
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-9rp4hu.3 AC3: setup in a fresh home writes the env, the keys and the unit and starts the unit', ({ Given, When, Then, And }) => {
    let home = '';
    let addr = '';
    let ran: Ran;

    Given('the postern binary and a fresh home', async () => {
      home = freshHome();
      addr = `127.0.0.1:${await freePort()}`;
      expect(existsSync(binary)).toBe(true);
    });
    When('postern setup runs there with an address and the issuer key', async () => {
      ran = await setup(home, addr);
      expect(ran.code, ran.stderr).toBe(0);
    });
    Then('the env file names that address, that issuer key, a data directory under the home and two different keys', () => {
      const env = envOf(home);
      expect(env.POSTERN_ADDR).toBe(addr);
      expect(env.POSTERN_ISSUER_KEY).toBe(ISSUER);
      expect(env.POSTERN_DATA).toBe(path.join(home, '.local', 'state', 'postern'));
      expect(env.POSTERN_MAYOR_KEY).toMatch(/^0[23][0-9a-f]{64}$/);
      expect(env.POSTERN_MILL_KEY).toMatch(/^0[23][0-9a-f]{64}$/);
      expect(env.POSTERN_MAYOR_KEY).not.toBe(env.POSTERN_MILL_KEY);
    });
    And('the user unit is installed and was enabled and started', () => {
      const unit = readFileSync(path.join(home, '.config', 'systemd', 'user', 'postern-backend.service'), 'utf-8');
      expect(unit).toContain(`EnvironmentFile=${path.join(home, '.config', 'postern', 'env')}`);
      expect(readFileSync(systemctlLog, 'utf-8')).toContain('--user enable --now postern-backend.service');
    });
    And("the output prints the Mayor key's public half and no private key", () => {
      expect(ran.stdout).toContain(envOf(home).POSTERN_MAYOR_KEY);
      const wif = readFileSync(path.join(home, '.config', 'mw', 'postern.key'), 'utf-8').trim();
      expect(ran.stdout + ran.stderr).not.toContain(wif);
    });
  });

  Scenario('mw-9rp4hu.3 AC3: a second setup in the same home refuses and changes nothing', ({ Given, When, And, Then }) => {
    let home = '';
    let addr = '';
    let before = '';
    let second: Ran;

    Given('the postern binary and a fresh home', async () => {
      home = freshHome();
      addr = `127.0.0.1:${await freePort()}`;
    });
    When('postern setup runs there with an address and the issuer key', async () => {
      const first = await setup(home, addr);
      expect(first.code, first.stderr).toBe(0);
      before = readFileSync(path.join(home, '.config', 'postern', 'env'), 'utf-8');
    });
    And('postern setup runs there again', async () => {
      second = await setup(home, addr);
    });
    Then('the second run fails saying the file is already there', () => {
      expect(second.code).not.toBe(0);
      expect(second.stderr).toContain('already there');
    });
    And('the env file is unchanged', () => {
      expect(readFileSync(path.join(home, '.config', 'postern', 'env'), 'utf-8')).toBe(before);
    });
  });

  Scenario('mw-9rp4hu.3 AC1: two backends from two homes answer health on two ports with different Mayor keys', ({ Given, When, Then, And }) => {
    const homes = [freshHome(), freshHome()];
    const addrs: string[] = [];

    Given('the postern binary and two homes each set up on its own port', async () => {
      for (const home of homes) {
        const addr = `127.0.0.1:${await freePort()}`;
        addrs.push(addr);
        const ran = await setup(home, addr);
        expect(ran.code, ran.stderr).toBe(0);
      }
    });
    When('both backends are started from their env files', () => {
      for (const home of homes) {
        const env = { ...process.env, ...envOf(home), POSTERN_WOC_BASE: 'http://127.0.0.1:1' };
        children.push(spawn(binary, [], { env, stdio: 'ignore' }));
      }
    });
    Then('both answer /healthz', async () => {
      expect(await healthz(addrs[0])).toBe(200);
      expect(await healthz(addrs[1])).toBe(200);
    });
    And('their Mayor keys differ and so do their data directories', () => {
      const [a, b] = homes.map(envOf);
      expect(a.POSTERN_MAYOR_KEY).not.toBe(b.POSTERN_MAYOR_KEY);
      expect(a.POSTERN_DATA).not.toBe(b.POSTERN_DATA);
      expect(a.POSTERN_ISSUER_KEY).toBe(b.POSTERN_ISSUER_KEY);
    });
  });
});
