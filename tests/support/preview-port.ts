// Which port the e2e preview server binds (mw-gq6.208). Landings on one host
// run `npm run gate:shots` side by side, each in its own worktree, so the
// port is derived from the worktree's absolute path: the same in Playwright's
// main process and its workers (both read this config), different between
// worktrees. 4400..5399 stays clear of spell-forge's 4173.
//
// The hash is only where the search starts (mw-gq6.931): a worktree with a random path can hash onto
// a port something else holds, and `--strictPort` then stops the run. resolvePreviewPort takes the
// next free port and writes it to PREVIEW_PORT, so the workers, which load the config again with the
// main process's environment, read the same port without searching.
import { execFileSync } from 'node:child_process';

type Env = Record<string, string | undefined>;

const PORT_BASE = 4400;
const PORT_SPAN = 1000;

export function previewPort(cwd: string, env: Env = process.env): number {
  const fromEnv = Number(env.PREVIEW_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  let hash = 0;
  for (const ch of cwd) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PORT_BASE + (hash % PORT_SPAN);
}

// Whether nothing is listening on the port, on IPv4 or IPv6: a throwaway node process tries to bind it
// (the config is loaded synchronously, so the probe has to be too).
export function portIsFree(port: number): boolean {
  const probe = `
    const net = require('node:net');
    const s = net.createServer();
    s.once('error', () => process.exit(1));
    s.listen({ port: ${port}, ipv6Only: false }, () => s.close(() => process.exit(0)));
  `;
  try {
    execFileSync(process.execPath, ['-e', probe], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// The port the e2e preview binds: PREVIEW_PORT as given, the hashed port when a person reuses their own
// server (PW_REUSE=1) or this is a Playwright worker, else the first free port from the hash on, wrapping
// inside 4400..5399. The choice is written to env.PREVIEW_PORT for the workers.
export function resolvePreviewPort(cwd: string, env: Env = process.env, isFree: (port: number) => boolean = portIsFree): number {
  const start = previewPort(cwd, env);
  if (env.PREVIEW_PORT !== undefined && String(start) === env.PREVIEW_PORT) return start;
  if (reuseExistingPreview(env) || env.TEST_WORKER_INDEX !== undefined) return start;
  for (let i = 0; i < PORT_SPAN; i += 1) {
    const port = PORT_BASE + ((start - PORT_BASE + i) % PORT_SPAN);
    if (isFree(port)) {
      env.PREVIEW_PORT = String(port);
      return port;
    }
  }
  throw new Error(`no free port in ${PORT_BASE}..${PORT_BASE + PORT_SPAN - 1} for the e2e preview`);
}

// A person working by hand with a preview already running can set PW_REUSE=1;
// a gate run never reuses another run's server.
export function reuseExistingPreview(env: Env = process.env): boolean {
  return env.PW_REUSE === '1';
}
