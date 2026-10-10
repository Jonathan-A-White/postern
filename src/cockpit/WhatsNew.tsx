// src/cockpit/WhatsNew.tsx — Postern's What's new (mw-s061bg.3), on bsv-kit's packages/whats-new:
// the sheet shown once after an update, and the link to CHANGELOG.md on GitHub beside the version.
// There is no Check for updates button and no list of versions in the app: the check runs by itself
// (appUpdate.ts). The banner's summary is in UpdateBanner.tsx.
import { WhatsNewSheet, useChangelog } from 'bsv-kit/whats-new';
import { Card, SectionTitle } from '../ui';
import { APP_VERSION, CHANGELOG_URL, WHATS_NEW_STORAGE_KEY } from '../services/whatsNew';
import { describeBuild } from '../services/buildLine';

/** The sheet that tells him what an update brought, once; nothing until the changelog is read, and nothing on a first install. */
export function WhatsNewOnUpdate() {
  const entries = useChangelog(import.meta.env.BASE_URL);
  return <WhatsNewSheet entries={entries} version={APP_VERSION} storageKey={WHATS_NEW_STORAGE_KEY} />;
}

/** The one place Postern's release notes live: a link to CHANGELOG.md on GitHub, shown beside the version. */
export function WhatsNewOnGitHub({ className }: { className?: string }) {
  return (
    <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" className={className}>
      What's new on GitHub
    </a>
  );
}

const LINK = 'text-accent underline underline-offset-2';

/** About's Version: this build and the link to what changed; the update check runs by itself (appUpdate.ts). */
export function AboutVersion() {
  const build = describeBuild(__APP_VERSION__);
  return (
    <section className="flex flex-col gap-2" aria-label="Version">
      <SectionTitle>Version</SectionTitle>
      <Card className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-4 text-[14px]">
        <span className="font-semibold">{APP_VERSION}</span>
        <span className="text-[12px] text-faint">{build.build}</span>
        <WhatsNewOnGitHub className={LINK} />
      </Card>
    </section>
  );
}
