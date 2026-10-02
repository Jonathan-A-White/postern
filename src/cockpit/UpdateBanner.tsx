// src/cockpit/UpdateBanner.tsx — 'Update ready, tap to reload', above the content on every screen while
// a newer build waits (mw-yxwtth.1). The tap goes dead and says 'Updating…' until the page reloads.
import { Icon } from '../ui';
import { applyUpdate, useUpdateState } from '../services/appUpdate';

export function UpdateBanner() {
  const state = useUpdateState();
  if (state === 'none') return null;
  const updating = state === 'updating';
  return (
    <button
      type="button"
      onClick={applyUpdate}
      disabled={updating}
      className="flex w-full shrink-0 items-center justify-center gap-2 border-b border-line bg-accent px-3 py-2 text-[13.5px] font-medium text-accent-fg disabled:opacity-70"
    >
      <Icon name="refresh" size={15} />
      {updating ? 'Updating…' : 'Update ready, tap to reload'}
    </button>
  );
}
