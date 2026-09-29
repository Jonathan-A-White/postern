// src/cockpit/SearchScreen.tsx — one box over everything (plans/0021 decision
// 13): beads in the live view, the descriptions and comments of every bead he
// has opened, and every message. Saved filters sit underneath as one-tap views
// of the map.
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, SectionTitle, TimeAgo } from '../ui';
import { Screen } from './Shell';
import { useMessages, useUnlockedKey, useViewIndex } from './hooks';
import { deleteFilter, useSavedFilters } from './savedFilters';
import { beadIdQuery, search, type SearchHit, type SearchHitKind } from '../model/search';
import { describeFilter } from '../model/filter';
import { allStoredBeadDetails, fetchBeadDetail } from '../services/beads';
import { getLiveState } from '../services/live';
import type { BeadDetail } from '../model/view';
import { beadHref, formatRoute, threadHrefFor } from '../nav/route';
import { navigate } from '../router';

const GROUPS: { kind: SearchHitKind; label: string }[] = [
  { kind: 'bead', label: 'Beads' },
  { kind: 'comment', label: 'Descriptions and comments' },
  { kind: 'message', label: 'Messages' },
];

function hitHref(hit: SearchHit): string {
  if (hit.kind === 'message') return threadHrefFor(hit.thread);
  return hit.bead ? beadHref(hit.bead) : formatRoute({ view: 'map' });
}

/** A bead id typed into Search that the phone's view does not hold: one tap
 * asks the backend for it (the read the bead screen does) and opens it. */
function OpenById({ id }: { id: string }) {
  const key = useUnlockedKey();
  const [outcome, setOutcome] = useState<{ id: string; note: string }>();
  const [busyId, setBusyId] = useState<string>();
  const note = outcome?.id === id ? outcome.note : undefined;

  function open() {
    if (!key) {
      setOutcome({ id, note: 'Unlock first to look it up.' });
      return;
    }
    setBusyId(id);
    fetchBeadDetail(id, { key, mayorKey: getLiveState().mayorKey })
      .then((fetched) => {
        if (fetched.status === 'ok') navigate(beadHref(id));
        else setOutcome({ id, note: fetched.status === 'missing' ? `no bead ${id}` : 'This backend cannot fetch one bead yet (docs/protocol.md §12).' });
      })
      .catch((err: unknown) => setOutcome({ id, note: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusyId(undefined));
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Open by id">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-faint">{id}</span>
        <Button size="sm" variant="primary" icon="search" busy={busyId === id} onClick={open}>
          Open {id}
        </Button>
      </div>
      {note && (
        <p role="status" className="px-1 text-sm text-muted">
          {note}
        </p>
      )}
    </section>
  );
}

export function SearchScreen({ q }: { q?: string }) {
  const view = useViewIndex();
  const messages = useMessages();
  const saved = useSavedFilters();
  const [query, setQuery] = useState(q ?? '');
  const [details, setDetails] = useState<BeadDetail[]>([]);

  useEffect(() => {
    void allStoredBeadDetails().then(setDetails);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = formatRoute({ view: 'search', q: query.trim() || undefined });
      if (next !== window.location.search) navigate(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const hits = useMemo(
    () => search(query, { beads: view?.index.view.beads ?? [], details, messages }),
    [query, view, details, messages],
  );

  const id = beadIdQuery(query);
  const offerOpen = id !== null && !hits.some((hit) => hit.kind === 'bead' && hit.bead === id);

  return (
    <Screen title="Search" subtitle="Beads, comments and messages">
      <div className="flex flex-col gap-5">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search everything…"
            className="h-12 w-full rounded-2xl pl-11 text-[16px]"
            autoFocus
          />
        </label>

        {!query.trim() && (
          <section className="flex flex-col gap-2" aria-label="Saved filters">
            <SectionTitle>Saved filters</SectionTitle>
            {saved.length === 0 ? (
              <p className="px-1 text-sm text-faint">Filter the map, then “Save filter” to keep it here.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {saved.map((entry) => (
                  <li key={entry.name} className="flex items-center gap-2 pr-2">
                    <a href={formatRoute({ view: 'map', filter: entry.name })} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-raised">
                      <Icon name="flag" size={16} className="text-accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-medium">{entry.name}</span>
                        <span className="block truncate text-[12px] text-faint">{describeFilter(entry.filter)}</span>
                      </span>
                    </a>
                    <IconButton icon="x" label={`Delete ${entry.name}`} size="sm" onClick={() => void deleteFilter(entry.name)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {offerOpen && <OpenById id={id} />}

        {query.trim() && hits.length === 0 && !offerOpen && <EmptyState icon="search" title="Nothing found">Beads you have opened are searched in full; others by title and summary.</EmptyState>}

        {GROUPS.map(({ kind, label }) => {
          const group = hits.filter((hit) => hit.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} className="flex flex-col gap-2" aria-label={label}>
              <SectionTitle>
                {label} · {group.length}
              </SectionTitle>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" data-testid={`hits-${kind}`}>
                {group.map((hit, i) => (
                  <li key={`${hit.kind}-${hit.bead}-${hit.messageId}-${i}`}>
                    <a href={hitHref(hit)} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-raised">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[14.5px] font-medium">{hit.title}</span>
                        {hit.bead && <span className="shrink-0 font-mono text-[11.5px] text-faint">{hit.bead}</span>}
                        {hit.at && <TimeAgo at={hit.at} className="ml-auto shrink-0 text-[11.5px] text-faint" />}
                      </span>
                      <span className="line-clamp-2 text-[13px] text-muted">{hit.snippet}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Screen>
  );
}
