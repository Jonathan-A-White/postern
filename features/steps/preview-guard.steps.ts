// features/steps/preview-guard.steps.ts — runs features/preview-guard.feature (mw-gq6.403): the guard
// in scripts/preview-guard.mjs that Playwright's webServer command goes through. The steps use real
// processes: a stand-in listener whose command line reads `vite preview` (it only listens), and the
// guard CLI wrapped round another.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { findListenerPids, stopLeftoverPreview } from '../../scripts/preview-guard.mjs';

const feature = await loadFeature('features/preview-guard.feature');

const LISTEN = "require('net').createServer().listen(Number(process.argv[1]))";
const SLOW = 6000;

const spawned: ChildProcess[] = [];
afterAll(() => {
  for (const child of spawned) child.kill('SIGKILL');
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

function listener(port: number, ...tail: string[]): ChildProcess {
  // node -e <code> <port> vite preview: argv reads like a leftover `vite preview` for this checkout
  const child = spawn(process.execPath, ['-e', LISTEN, String(port), ...tail], { stdio: 'ignore' });
  spawned.push(child);
  return child;
}

async function until(check: () => boolean, ms = SLOW): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

const listening = (port: number) => findListenerPids(port).length > 0;
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a leftover vite preview from this checkout on the preview port is stopped, then the server starts', ({ Given, When, Then, And }) => {
    let port = 0;
    let leftover: ChildProcess;
    let guard: ChildProcess;
    Given('a leftover "vite preview" from this checkout is listening on the preview port', async () => {
      port = await freePort();
      leftover = listener(port, 'vite', 'preview');
      expect(await until(() => listening(port))).toBe(true);
    });
    When('the guard starts the preview server for that port', () => {
      guard = spawn(process.execPath, ['scripts/preview-guard.mjs', String(port), '--', process.execPath, '-e', LISTEN, String(port)], { stdio: 'ignore' });
      spawned.push(guard);
    });
    Then('the leftover is gone', async () => {
      expect(await until(() => exited(leftover))).toBe(true);
    });
    And('the new server is listening on the preview port', async () => {
      expect(await until(() => listening(port))).toBe(true);
      expect(findListenerPids(port)).not.toContain(leftover.pid);
    });
  });

  Scenario('AC-1: a listener on the port that is not a vite preview from this checkout is left alone', ({ Given, When, Then, And }) => {
    let port = 0;
    let other: ChildProcess;
    let stopped: number[] = [];
    Given('a listener that is not a vite preview from this checkout is on the preview port', async () => {
      port = await freePort();
      other = listener(port, 'something', 'else');
      expect(await until(() => listening(port))).toBe(true);
    });
    When('the guard looks for a leftover on that port', () => {
      stopped = stopLeftoverPreview(port);
    });
    Then('it stops nothing', () => {
      expect(stopped).toEqual([]);
    });
    And('the listener is still there', () => {
      expect(exited(other)).toBe(false);
      expect(listening(port)).toBe(true);
    });
  });

  Scenario('AC-2: nothing listens on the preview port once the run ends', ({ Given, When, Then }) => {
    let port = 0;
    let guard: ChildProcess;
    Given('the guard is running the preview server on the preview port', async () => {
      port = await freePort();
      guard = spawn(process.execPath, ['scripts/preview-guard.mjs', String(port), '--', process.execPath, '-e', LISTEN, String(port)], { stdio: 'ignore' });
      spawned.push(guard);
      expect(await until(() => listening(port))).toBe(true);
    });
    When('the run ends', async () => {
      // Playwright ends a webServer with SIGTERM
      guard.kill('SIGTERM');
      expect(await until(() => exited(guard))).toBe(true);
    });
    Then('nothing listens on the preview port', async () => {
      expect(await until(() => !listening(port))).toBe(true);
    });
  });

  Scenario('AC-2: nothing listens on the preview port after the run is interrupted', ({ Given, When, Then }) => {
    let port = 0;
    let guard: ChildProcess;
    Given('the guard is running the preview server on the preview port', async () => {
      port = await freePort();
      guard = spawn(process.execPath, ['scripts/preview-guard.mjs', String(port), '--', process.execPath, '-e', LISTEN, String(port)], { stdio: 'ignore' });
      spawned.push(guard);
      expect(await until(() => listening(port))).toBe(true);
    });
    When('the run is interrupted with Ctrl+C', async () => {
      guard.kill('SIGINT');
      expect(await until(() => exited(guard))).toBe(true);
    });
    Then('nothing listens on the preview port', async () => {
      expect(await until(() => !listening(port))).toBe(true);
    });
  });
});
