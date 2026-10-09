// src/cockpit/WhatsNew.tsx — Postern's What's new (mw-s061bg.3), on bsv-kit's packages/whats-new:
// the sheet shown once after an update, and the About section with the version's link, Check for
// updates and every version. The banner's summary is in UpdateBanner.tsx.
import { CheckForUpdates, WhatsNewList, WhatsNewSheet, useChangelog } from 'bsv-kit/whats-new';
import { Button, Card, SectionTitle } from '../ui';
import { applyUpdate } from '../services/appUpdate';
import { APP_VERSION, WHATS_NEW_STORAGE_KEY, changelogLink } from '../services/whatsNew';
import { describeBuild } from '../services/buildLine';
import { formatRoute } from '../nav/route';

/** The sheet that tells him what an update brought, once; nothing until the changelog is read, and nothing on a first install. */
export function WhatsNewOnUpdate() {
  const entries = useChangelog(import.meta.env.BASE_URL);
  return <WhatsNewSheet entries={entries} version={APP_VERSION} storageKey={WHATS_NEW_STORAGE_KEY} />;
}

/** The running version as a link to its place in CHANGELOG.md (a private repo: to About, which lists the versions). */
export function VersionLink({ className }: { className?: string }) {
  const href = changelogLink();
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {APP_VERSION}
    </a>
  ) : (
    <a href={formatRoute({ view: 'about' })} className={className}>
      {APP_VERSION}
    </a>
  );
}

const LINK = 'text-accent underline underline-offset-2';

/** About's What's new: this build, Check for updates, and every version with its lines. */
export function AboutWhatsNew() {
  const entries = useChangelog(import.meta.env.BASE_URL);
  const build = describeBuild(__APP_VERSION__);
  return (
    <section className="flex flex-col gap-2" aria-label="What's new">
      <SectionTitle>What's new</SectionTitle>
      <Card className="flex flex-col gap-3 p-4">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <span className="text-muted">Version</span>
          <VersionLink className={`${LINK} font-semibold`} />
          <span className="text-[12px] text-faint">{build.build}</span>
        </p>
        <CheckForUpdates
          updateReady={
            <Button size="sm" icon="refresh" onClick={applyUpdate}>
              Update ready, tap to reload
            </Button>
          }
        />
        <WhatsNewList entries={entries} />
      </Card>
    </section>
  );
}
