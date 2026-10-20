// src/cockpit/IdeasOnlyBanner.tsx — while Ideas only is on (docs/protocol.md §25) the app says so at the top of
// every screen, until it ends by itself: the stream's event, or the phone's clock reaching the end. A tap
// opens Settings (the Ideas only section) and does nothing else.
import { Icon } from '../ui';
import { untilClock } from '../model/ideasOnly';
import { navigate } from '../router';
import { useIdeasOnly, useIdeasOnlyNow } from './useIdeasOnly';

export function IdeasOnlyBanner() {
  // Asked once as the app opens, so a mode set from another phone shows here too; the screen reads the kept answer.
  useIdeasOnly();
  const on = useIdeasOnlyNow();
  if (!on) return null;
  return (
    <section data-testid="ideas-only-banner" className="shrink-0 px-2 pt-2">
      <button
        type="button"
        onClick={() => navigate({ view: 'me' })}
        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm"
      >
        <Icon name="clock" size={18} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">Ideas only until {untilClock(on.until, on.nowMs)}</span>
          <span className="text-[12.5px] text-muted">Ideas are kept; to-dos still work</span>
        </span>
      </button>
    </section>
  );
}
