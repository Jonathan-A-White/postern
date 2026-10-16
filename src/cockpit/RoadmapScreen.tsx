// src/cockpit/RoadmapScreen.tsx — the Roadmap (mw-njb33n.3): four calm lanes, Now (P0-P1), Next (P2),
// Later (P3) and Icebox, each a row per app with its count and its top title. A tap opens an app to
// its titles, each a link to its bead. Phone-first and nothing animated. Beside the lanes, a Picture
// (mw-njb33n.6: RoadmapPicture): lanes stay the default, and a phone with no WebGL stays on them.
import { useCallback, useMemo, useState } from 'react';
import { Chip, EmptyState, Icon, Segmented, Spinner } from '../ui';
import { Screen } from './Shell';
import { useViewIndex } from './hooks';
import { roadmap, type RoadmapApp, type RoadmapLane } from '../model/roadmap';
import type { ViewIndex } from '../model/tree';
import { beadHref } from '../nav/route';
import { RoadmapPicture } from './RoadmapPicture';

function AppRow({ entry, open, onToggle }: { entry: RoadmapApp; open: boolean; onToggle: () => void }) {
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${entry.app}, ${entry.beads.length}`}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="text-[14.5px] font-semibold">{entry.app}</span>
            <span className="text-[12.5px] text-faint tabular-nums">{entry.beads.length}</span>
          </span>
          <span className="line-clamp-2 text-[13px] leading-snug text-muted wrap-anywhere">{entry.top.title}</span>
        </span>
        <Icon name={open ? 'down' : 'forward'} size={15} className="shrink-0 text-muted" />
      </button>
      {open && (
        <ul className="flex flex-col gap-2 px-4 pb-3" aria-label={`${entry.app} stories`}>
          {entry.beads.map((bead) => (
            <li key={bead.id}>
              <a href={beadHref(bead.id)} className="flex min-w-0 items-start gap-2 text-[14px] leading-snug hover:underline">
                <Chip mono>{bead.id}</Chip>
                <span className="min-w-0 wrap-anywhere">{bead.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Lane({ lane }: { lane: RoadmapLane }) {
  const [openApps, setOpenApps] = useState<ReadonlySet<string>>(new Set());
  const toggle = (app: string) =>
    setOpenApps((was) => {
      const next = new Set(was);
      if (!next.delete(app)) next.add(app);
      return next;
    });
  return (
    <section className="flex flex-col gap-2" aria-label={lane.label}>
      <h2 className="flex items-center gap-2 px-1 text-[12.5px] font-semibold text-muted">
        {lane.label}
        <span className="text-faint tabular-nums" data-testid="lane-count">
          {lane.count}
        </span>
      </h2>
      {lane.apps.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">Nothing here</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {lane.apps.map((entry) => (
            <AppRow key={entry.app} entry={entry} open={openApps.has(entry.app)} onToggle={() => toggle(entry.app)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The four lanes of a view, with no screen around them. */
export function Roadmap({ index }: { index: ViewIndex }) {
  const lanes = useMemo(() => roadmap(index), [index]);
  return (
    <div className="flex flex-col gap-5" data-testid="roadmap">
      {lanes.map((lane) => (
        <Lane key={lane.id} lane={lane} />
      ))}
    </div>
  );
}

export function RoadmapScreen() {
  const view = useViewIndex();
  const index = view?.index;
  const back = { view: 'map' } as const;
  if (view === undefined) {
    return (
      <Screen title="Roadmap" back={back}>
        <div className="flex justify-center py-16 text-muted">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }
  if (!index) {
    return (
      <Screen title="Roadmap" back={back}>
        <EmptyState icon="map" title="No view of the factory yet">
          It arrives once the backend answers.
        </EmptyState>
      </Screen>
    );
  }
  return (
    <Screen title="Roadmap" subtitle="Now · Next · Later · Icebox" back={back}>
      <LanesOrPicture index={index} />
    </Screen>
  );
}

type Mode = 'lanes' | 'picture';

/** The lanes, or the Picture beside them when he asks and this phone can draw it. */
function LanesOrPicture({ index }: { index: ViewIndex }) {
  const [mode, setMode] = useState<Mode>('lanes');
  const [noWebgl, setNoWebgl] = useState(false);
  const unavailable = useCallback(() => setNoWebgl(true), []);
  const shown: Mode = mode === 'picture' && !noWebgl ? 'picture' : 'lanes';
  return (
    <div className="flex flex-col gap-4">
      <Segmented<Mode>
        label="Roadmap view"
        value={shown}
        onChange={setMode}
        options={[
          { value: 'lanes', label: 'Lanes' },
          { value: 'picture', label: 'Picture' },
        ]}
      />
      {noWebgl && mode === 'picture' && (
        <p role="status" className="px-1 text-[13px] text-muted">
          This phone cannot draw the Picture (it needs WebGL), so the lanes are shown.
        </p>
      )}
      {shown === 'picture' ? <RoadmapPicture index={index} onUnavailable={unavailable} /> : <Roadmap index={index} />}
    </div>
  );
}
