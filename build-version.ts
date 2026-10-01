// The version string Postern shows on Me and the gate (mw-gq6.196): the package version
// never changes, so the build stamps its UTC time and the short git commit beside it and
// he can tell on his phone whether the new build has loaded. Shared by vite.config.ts and
// vitest.config.ts (as pwa-manifest.ts is) so a test reads the same string.
import { execFileSync } from 'node:child_process';

/** The short HEAD commit of the checkout at `cwd`; 'dev' when there is no git or no checkout, never a throw. */
export function shortCommit(cwd: string = process.cwd(), git = 'git'): string {
  try {
    const out = execFileSync(git, ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || 'dev';
  } catch {
    return 'dev';
  }
}

/** '<version> · YYYY-MM-DD HH:MMZ · <commit>', the time in UTC. */
export function buildVersion(version: string, when: Date, commit: string): string {
  return `${version} · ${when.toISOString().slice(0, 16).replace('T', ' ')}Z · ${commit}`;
}
