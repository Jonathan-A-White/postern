// src/services/whatsNew.ts — what Postern says about its releases (mw-s061bg.3), the facts pwa-kit's
// whats-new package is given: the version this build is, where the last one seen is kept, and the
// CHANGELOG.md on GitHub that What's new on GitHub links to.
import { fetchChangelog, summarise, type ChangelogEntry } from 'pwa-kit/whats-new';
import type { AppUpdateOptions } from 'pwa-kit/app-update';
import { describeBuild } from './buildLine';
import { APP_VERSION_STRING } from '../version';

/** The package version this build is ('0.5.10'), without the build time and commit. */
export const APP_VERSION = describeBuild(APP_VERSION_STRING).version;

/** Where the last version he saw What's new for is kept (localStorage). */
export const WHATS_NEW_STORAGE_KEY = 'postern.lastSeenVersion';

export const REPO = 'Jonathan-A-White/postern';

/** Where What's new on GitHub opens: the repo's CHANGELOG.md. */
export const CHANGELOG_URL = `https://github.com/${REPO}/blob/main/CHANGELOG.md`;

/** Reads the waiting build's changelog (fetchChangelog asks with cache 'no-store'); null when it cannot be read. */
export type ReadChangelog = () => Promise<ChangelogEntry[] | null>;

/**
 * The judge pwa-kit/app-update is handed (mw-6ww.175.34): a waiting build is offered, with its 'Update ready' banner, only if
 * the changelog, read fresh from the server, has a line after the running version. A build with none (tests, lint, a version
 * bump) is taken quietly at start-up or when the app is hidden. A changelog that cannot be read rejects, and the banner is offered.
 */
export function hasNewsSince(read: ReadChangelog): (version: string) => Promise<boolean> {
  return async (version) => {
    const entries = await read();
    if (entries === null) throw new Error('The changelog could not be read');
    return summarise(entries, version) !== null;
  };
}

/** What startAppUpdates is given besides the registration: the running version and the judge, reading the waiting build's changelog. */
export function updateOptions(read: ReadChangelog = () => fetchChangelog(import.meta.env.BASE_URL)): AppUpdateOptions {
  return { version: APP_VERSION, hasNewsSince: hasNewsSince(read) };
}
