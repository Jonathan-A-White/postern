// src/cockpit/MapScreen.tsx — the wayfinder map at every zoom (plans/0021
// decision 9). At the top: the factory's pulse and every live map and epic as a
// card with its progress. Zoomed into an epic: its own child epics, then its work
// as a board by column (the phone's default), a dependency graph (the wide
// screen's default) or a plain list — the same filter over all three.
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, EmptyState, Icon, SectionTitle, Segmented, Spinner, cx } from '../ui';
import { Screen } from './Shell';
import { FactoryPulse } from './FactoryPulse';
import { BeadCard, BeadRow, EpicCard, ProgressBar } from './BeadCards';
import { Graph } from './Graph';
import { FilterBar } from './FilterBar';
import { loadSavedFilters } from './savedFilters';
import { useViewIndex, useWide } from './hooks';
import { ancestors, BUCKETS, bucketOf, epicStats, isEpic, isMap, topLevel, type Bucket, type ViewIndex } from '../model/tree';
import { EMPTY_FILTER, facets, isEmptyFilter, matchesFilter, newestFirst, type BeadFilter } from '../model/filter';
import type { ViewBead } from '../model/view';
import { beadHref, formatRoute, type MapLens } from '../nav/route';
import { navigate } from '../router';
import { sendAction, useSend } from './send';

function Breadcrumb({ id, index }: { id: string; index: ViewIndex }) {
  const chain = ancestors(id, index);
  return (
    <nav aria-label="Where this is" className="no-scrollbar flex items-center gap-1 overflow-x-auto text-[12.5px] text-muted">
      <a href={formatRoute({ view: 'map' })} className="shrink-0 hover:text-fg">
        Factory
      </a>
      {chain.map((bead) => (
        <span key={bead.id} className="flex shrink-0 items-center gap-1">
          <Icon name="forward" size={12} className="text-faint" />
          <a href={formatRoute({ view: 'map', focus: bead.id })} className="max-w-[16rem] truncate hover:text-fg">
            {bead.title}
          </a>
        </span>
      ))}
    </nav>
  );
}

function Board({ beads, index }: { beads: ViewBead[]; index: ViewIndex }) {
  const columns = BUCKETS.map((column) => ({ ...column, beads: beads.filter((bead) => bucketOf(bead, index) === column.bucket) })).filter(
    (column) => column.beads.length > 0,
  );
  if (columns.length === 0) return null;
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-4" data-testid="board">
      {columns.map((column) => (
        <section key={column.bucket} aria-label={column.label} className="flex w-[82%] shrink-0 snap-start flex-col gap-2 sm:w-72 lg:w-auto">
          <h3 className="flex items-center gap-2 px-1 text-[12.5px] font-semibold text-muted">
            <span className={cx('h-2 w-2 rounded-full', { needs: 'bg-needs', working: 'bg-working', ready: 'bg-ready', blocked: 'bg-blocked', held: 'bg-held', done: 'bg-done' }[column.bucket])} />
            {column.label}
            <span className="text-faint tabular-nums">{column.beads.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {column.beads.map((bead) => (
              <BeadCard key={bead.id} bead={bead} index={index} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function List({ beads, index }: { beads: ViewBead[]; index: ViewIndex }) {
  if (beads.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" data-testid="bead-list">
      {beads.map((bead) => (
        <li key={bead.id}>
          <BeadRow bead={bead} index={index} />
        </li>
      ))}
    </ul>
  );
}

/** The filter a map opens with: the column a factory figure named, or a saved
 * filter by name (loaded once it is read). MapScreen is keyed by both, so a new
 * one starts a fresh filter rather than patching the old. */
function useInitialFilter(bucket?: string, saved?: string): [BeadFilter, (filter: BeadFilter) => void] {
  const [filter, setFilter] = useState<BeadFilter>(() => ({ ...EMPTY_FILTER, buckets: bucket ? [bucket as Bucket] : [] }));
  useEffect(() => {
    if (!saved) return;
    void loadSavedFilters().then((all) => {
      const found = all.find((entry) => entry.name === saved);
      if (found) setFilter(found.filter);
    });
  }, [saved]);
  return [filter, setFilter];
}

function FactoryLevel({ index, filter, setFilter }: { index: ViewIndex; filter: BeadFilter; setFilter: (f: BeadFilter) => void }) {
  const { rigs, hosts } = useMemo(() => facets(index), [index]);
  const tops = useMemo(() => topLevel(index), [index]);
  const matches = useMemo(
    () => (isEmptyFilter(filter) ? [] : newestFirst(index.view.beads.filter((bead) => !isEpic(bead, index) && matchesFilter(bead, index, filter))).slice(0, 300)),
    [index, filter],
  );
  const maps = tops.filter(isMap);
  const epics = tops.filter((bead) => !isMap(bead));
  return (
    <div className="flex flex-col gap-5">
      <FactoryPulse index={index} />
      <FilterBar filter={filter} onChange={setFilter} rigs={rigs} hosts={hosts} />
      {!isEmptyFilter(filter) ? (
        <section className="flex flex-col gap-2" aria-label="Matching work">
          <SectionTitle>{matches.length} matching</SectionTitle>
          {matches.length ? <List beads={matches} index={index} /> : <EmptyState icon="filter" title="Nothing matches" />}
        </section>
      ) : (
        <>
          {maps.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Maps">
              <SectionTitle>Maps</SectionTitle>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {maps.map((bead) => (
                  <EpicCard key={bead.id} epic={bead} index={index} />
                ))}
              </div>
            </section>
          )}
          <section className="flex flex-col gap-2" aria-label="Epics">
            <SectionTitle>Epics</SectionTitle>
            {epics.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {epics.map((bead) => (isEpic(bead, index) ? <EpicCard key={bead.id} epic={bead} index={index} /> : <BeadCard key={bead.id} bead={bead} index={index} />))}
              </div>
            ) : (
              <EmptyState icon="layers" title="No live epics" />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function EpicLevel({ epic, index, lens, filter, setFilter }: { epic: ViewBead; index: ViewIndex; lens: MapLens; filter: BeadFilter; setFilter: (f: BeadFilter) => void }) {
  const { busy, run } = useSend();
  const children = index.children.get(epic.id) ?? [];
  const childEpics = children.filter((bead) => isEpic(bead, index));
  const work = children.filter((bead) => !isEpic(bead, index) && matchesFilter(bead, index, filter));
  const stats = epicStats(epic.id, index);
  const { rigs, hosts } = useMemo(() => facets(index), [index]);
  const held = stats.counts.held;
  const setLens = (next: MapLens) => navigate(formatRoute({ view: 'map', focus: epic.id, lens: next }), { replace: true });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Breadcrumb id={epic.id} index={index} />
        <div className="flex flex-wrap items-center gap-2">
          <Chip mono>{epic.id}</Chip>
          {isMap(epic) && (
            <Chip tone="needs" icon="map">
              map
            </Chip>
          )}
          {stats.rigs.map((rig) => (
            <Chip key={rig}>{rig}</Chip>
          ))}
          {stats.needs > 0 && (
            <Chip tone="needs" icon="needs">
              {stats.needs} need you
            </Chip>
          )}
        </div>
        <ProgressBar counts={{ ...stats.counts, done: stats.done }} total={stats.total} />
        <p className="text-[13px] text-muted">
          {stats.done} of {stats.total} done · {stats.counts.working} working · {stats.counts.ready} ready · {stats.counts.blocked} blocked
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={beadHref(epic.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-sm hover:border-line-strong">
            <Icon name="talk" size={16} />
            Discuss
          </a>
          {held > 0 && (
            <Button size="sm" variant="primary" icon="release" busy={busy} onClick={() => void run(() => sendAction({ action: 'release', bead: epic.id }), `Released ${epic.id}`)}>
              Release {held} held
            </Button>
          )}
        </div>
      </div>

      {childEpics.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Inside">
          <SectionTitle>Inside</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {childEpics.map((bead) => (
              <EpicCard key={bead.id} epic={bead} index={index} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-label="Work">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Work</SectionTitle>
          <Segmented<MapLens>
            label="How to show the work"
            value={lens}
            onChange={setLens}
            options={[
              { value: 'board', label: 'Board', icon: 'board' },
              { value: 'graph', label: 'Graph', icon: 'graph' },
              { value: 'list', label: 'List', icon: 'list' },
            ]}
          />
        </div>
        <FilterBar filter={filter} onChange={setFilter} rigs={rigs} hosts={hosts} placeholder="Filter this epic…" />
        {work.length === 0 ? (
          <EmptyState icon="board" title={children.length ? 'Nothing matches' : 'No work filed yet'} />
        ) : lens === 'graph' ? (
          <Graph beads={work} index={index} />
        ) : lens === 'list' ? (
          <List beads={newestFirst(work)} index={index} />
        ) : (
          <Board beads={work} index={index} />
        )}
      </section>
    </div>
  );
}

export function MapScreen({ focus, lens, bucket, filter: savedFilter }: { focus?: string; lens?: MapLens; bucket?: string; filter?: string }) {
  const view = useViewIndex();
  const wide = useWide();
  const [filter, setFilter] = useInitialFilter(bucket, savedFilter);
  const index = view?.index;
  const epic = focus ? index?.byId.get(focus) : undefined;

  if (view === undefined) {
    return (
      <Screen title="Map">
        <div className="flex justify-center py-16 text-muted">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }
  if (!index) {
    return (
      <Screen title="Map">
        <EmptyState icon="map" title="No view of the factory yet">
          It arrives once the backend answers.
        </EmptyState>
      </Screen>
    );
  }
  if (focus && !epic) {
    return (
      <Screen title={focus} back={{ view: 'map' }}>
        <EmptyState icon="map" title="Not in the live view">
          {focus} is not among the live epics (it may have closed more than a week ago).{' '}
          <a className="underline" href={beadHref(focus)}>
            Open it anyway
          </a>
        </EmptyState>
      </Screen>
    );
  }
  if (epic) {
    return (
      <Screen title={epic.title} subtitle={epic.id} back={epic.parent ? { view: 'map', focus: epic.parent } : { view: 'map' }}>
        <EpicLevel epic={epic} index={index} lens={lens ?? (wide ? 'graph' : 'board')} filter={filter} setFilter={setFilter} />
      </Screen>
    );
  }
  return (
    <Screen title="Map" subtitle={`${index.view.beads.length} beads · ${index.view.host || 'factory'}`}>
      <FactoryLevel index={index} filter={filter} setFilter={setFilter} />
    </Screen>
  );
}
