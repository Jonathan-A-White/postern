// src/services/whatsNew.ts — what Postern says about its releases (mw-s061bg.3), the facts bsv-kit's
// whats-new package is given: the version this build is, where the last one seen is kept, and the repo
// whose CHANGELOG.md the version links to.
import { versionLink } from 'bsv-kit/whats-new';
import { describeBuild } from './buildLine';

/** The package version this build is ('0.5.10'), without the build time and commit. */
export const APP_VERSION = describeBuild(__APP_VERSION__).version;

/** Where the last version he saw What's new for is kept (localStorage). */
export const WHATS_NEW_STORAGE_KEY = 'postern.lastSeenVersion';

export const REPO = 'Jonathan-A-White/postern';

/** `gh repo view --json visibility` says PUBLIC (2026-10-09); if the repo goes private, set this false and the version opens the list. */
export const REPO_IS_PUBLIC = true;

/** The version's place in CHANGELOG.md on GitHub, or null when the repo is private. */
export function changelogLink(version: string = APP_VERSION): string | null {
  return versionLink({ repo: REPO, public: REPO_IS_PUBLIC, version });
}
