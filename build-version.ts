// The version string Postern shows on Me and the gate (mw-gq6.196): the package version
// never changes, so the build stamps its UTC time and the short git commit beside it and
// he can tell on his phone whether the new build has loaded. Shared by vite.config.ts and
// vitest.config.ts (as pwa-manifest.ts is) so a test reads the same string.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The short HEAD commit of the checkout at `cwd`; 'dev' when there is no git or no checkout, never a throw. */
export function shortCommit(cwd: string = process.cwd(), git = 'git'): string {
  try {
    const out = execFileSync(git, ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * The version the build stamps: the one package.json holds at HEAD, the commit the stamp names beside it, so
 * the two never disagree (mw-6ww.175.36: a working file older than HEAD stamped 0.8.111 beside the commit
 * that says 0.8.112). Outside a checkout, or where HEAD has no package.json, the working file's version.
 */
export function packageVersion(cwd: string = process.cwd(), git = 'git'): string {
  try {
    const committed = execFileSync(git, ['show', 'HEAD:./package.json'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const version = (JSON.parse(committed) as { version?: unknown }).version;
    if (typeof version === 'string' && version) return version;
  } catch {
    // no git, no HEAD or no committed package.json: the working file below
  }
  return (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { version: string }).version;
}

/** '<version> · YYYY-MM-DD HH:MMZ · <commit>', the time in UTC. */
export function buildVersion(version: string, when: Date, commit: string): string {
  return `${version} · ${when.toISOString().slice(0, 16).replace('T', ' ')}Z · ${commit}`;
}

/**
 * The time a build is stamped with: POSTERN_BUILD_AT when it names a time (a reproducible build, and the
 * test that builds twice a day apart), otherwise now.
 */
export function buildStampAt(): Date {
  const named = new Date(process.env.POSTERN_BUILD_AT ?? '');
  return Number.isNaN(named.getTime()) ? new Date() : named;
}

/**
 * The script that hands the version string to the app: index.html carries it, not a chunk of code, so a
 * build whose code is unchanged leaves the main chunk's name and bytes alone (mw-7dige5.3). `<` is escaped
 * so the string can never close the script tag.
 */
export function buildStampHtml(version: string): string {
  return `window.__APP_VERSION__=${JSON.stringify(version).replace(/</g, '\\u003c')};`;
}
