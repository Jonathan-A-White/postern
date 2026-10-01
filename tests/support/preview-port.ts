// Which port the e2e preview server binds (mw-gq6.208). Landings on one host
// run `npm run gate:shots` side by side, each in its own worktree, so the
// port is derived from the worktree's absolute path: the same in Playwright's
// main process and its workers (both read this config), different between
// worktrees. 4400..5399 stays clear of spell-forge's 4173.
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

// A person working by hand with a preview already running can set PW_REUSE=1;
// a gate run never reuses another run's server.
export function reuseExistingPreview(env: Env = process.env): boolean {
  return env.PW_REUSE === '1';
}
