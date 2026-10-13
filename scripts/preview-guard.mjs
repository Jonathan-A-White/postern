#!/usr/bin/env node
// scripts/preview-guard.mjs — mw-gq6.403: playwright.config.ts starts the e2e preview server as
//   node scripts/preview-guard.mjs <port> -- <command...>
// A `vite preview` left on that port by an earlier run that never stopped it (killed hard, a lost
// terminal) made every later shots run fail with "port already used"; stopLeftoverPreview stops it,
// when it is this checkout's own (playwright.config.ts calls it as it loads; the CLI does too, for a
// preview that appeared since). The CLI then runs the command in the guard's process group and, when Playwright
// ends it (SIGTERM at the end of a run, SIGINT on Ctrl+C, a timeout) or the command ends, stops the
// whole group, so nothing is left listening.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The pids of the processes listening on a TCP port (ss -p names them for this user's processes).
export function findListenerPids(port) {
  let out = '';
  try {
    out = execFileSync('ss', ['-H', '-ltnp', 'sport', '=', `:${port}`], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
}

// A `vite preview` whose working directory is this checkout (npm run preview leaves exactly that).
function isPreviewOf(pid, cwd) {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!args.some((a) => /(^|[\\/])vite(\.js)?$/.test(a)) || !args.includes('preview')) return false;
    return realpathSync(`/proc/${pid}/cwd`) === realpathSync(cwd);
  } catch {
    return false;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A synchronous pause: Playwright's config is loaded synchronously, before it checks the port.
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stop(pid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
    for (let i = 0; i < 40 && alive(pid); i += 1) pause(50);
    if (!alive(pid)) return;
  }
}

// Stops the leftover `vite preview` of this checkout on the port; returns the pids it stopped.
// playwright.config.ts calls it as the config loads, because Playwright refuses to start when the
// port is taken before it ever runs the webServer command.
export function stopLeftoverPreview(port, cwd = process.cwd()) {
  const stale = findListenerPids(port).filter((pid) => isPreviewOf(pid, cwd));
  for (const pid of stale) stop(pid);
  return stale;
}

async function main(argv) {
  const sep = argv.indexOf('--');
  const port = Number(argv[0]);
  const command = sep === -1 ? [] : argv.slice(sep + 1);
  if (!Number.isInteger(port) || command.length === 0) {
    console.error('usage: preview-guard.mjs <port> -- <command...>');
    process.exit(2);
  }
  const stopped = stopLeftoverPreview(port);
  if (stopped.length > 0) console.error(`preview-guard: stopped a leftover vite preview on port ${port} (pid ${stopped.join(', ')})`);

  // Not detached: Playwright starts the guard as a process-group leader and ends the whole group
  // (also with SIGKILL, which the guard cannot catch), so the command must stay in that group.
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
  const ownGroup = () => Number(readFileSync('/proc/self/stat', 'utf8').replace(/^.*\) /, '').split(' ')[2]) === process.pid;
  const killGroup = (signal) => {
    try {
      if (ownGroup()) process.kill(-process.pid, signal);
    } catch {
      /* already gone */
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      child.kill('SIGTERM');
      // anything that outlives a polite stop gets the hard one, the guard included
      setTimeout(() => {
        child.kill('SIGKILL');
        killGroup('SIGKILL');
        process.exit(0);
      }, 2000).unref();
    });
  }
  child.on('error', (err) => {
    console.error(`preview-guard: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    const status = signal ? 0 : (code ?? 0);
    killGroup('SIGKILL'); // the command's own children (npm run -> vite) go with it; the guard too
    process.exit(status);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
