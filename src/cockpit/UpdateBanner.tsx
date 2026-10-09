// src/cockpit/UpdateBanner.tsx — 'Update ready, tap to reload', above the content on every screen while
// a newer build waits (mw-yxwtth.1). The tap goes dead and says 'Updating…' until the page reloads.
// Beneath it, once the waiting build's changelog is read, its version and what is in it, with a
// What's new button that opens the lines (mw-s061bg.3); no changelog, no line.
import { useState } from 'react';
import { UpdateSummary, WhatsNewSheet, useChangelog } from 'bsv-kit/whats-new';
import { Icon } from '../ui';
import { applyUpdate, useUpdateState } from '../services/appUpdate';
import { APP_VERSION, WHATS_NEW_STORAGE_KEY } from '../services/whatsNew';

/** Mounted only while a build waits, so the changelog it reads is the waiting build's (fetched no-store). */
function WaitingSummary() {
  const entries = useChangelog(import.meta.env.BASE_URL);
  const [open, setOpen] = useState(false);
  return (
    <>
      <UpdateSummary entries={entries} since={APP_VERSION} onOpen={() => setOpen(true)} className="text-[12.5px]" />
      <WhatsNewSheet entries={entries} version={APP_VERSION} storageKey={WHATS_NEW_STORAGE_KEY} open={open} since={APP_VERSION} onClose={() => setOpen(false)} />
    </>
  );
}

export function UpdateBanner() {
  const state = useUpdateState();
  if (state === 'none') return null;
  const updating = state === 'updating';
  return (
    <div className="flex w-full shrink-0 flex-col items-center border-b border-line bg-accent text-accent-fg">
      <button
        type="button"
        onClick={applyUpdate}
        disabled={updating}
        className="flex w-full items-center justify-center gap-2 px-3 py-2 text-[13.5px] font-medium disabled:opacity-70"
      >
        <Icon name="refresh" size={15} />
        {updating ? 'Updating…' : 'Update ready, tap to reload'}
      </button>
      {!updating && <WaitingSummary />}
    </div>
  );
}
