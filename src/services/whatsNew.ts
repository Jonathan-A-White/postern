// src/services/whatsNew.ts — what Postern says about its releases (mw-s061bg.3), the facts bsv-kit's
// whats-new package is given: the version this build is, where the last one seen is kept, and the
// CHANGELOG.md on GitHub that What's new on GitHub links to.
import { describeBuild } from './buildLine';

/** The package version this build is ('0.5.10'), without the build time and commit. */
export const APP_VERSION = describeBuild(__APP_VERSION__).version;

/** Where the last version he saw What's new for is kept (localStorage). */
export const WHATS_NEW_STORAGE_KEY = 'postern.lastSeenVersion';

export const REPO = 'Jonathan-A-White/postern';

/** Where What's new on GitHub opens: the repo's CHANGELOG.md. */
export const CHANGELOG_URL = `https://github.com/${REPO}/blob/main/CHANGELOG.md`;
