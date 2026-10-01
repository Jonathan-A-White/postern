// src/cockpit/OpenLists.tsx — 'Grillings · N' and 'Open maps · N' (mw-f758y.30):
// two chips under the factory's pulse, on Needs you and on the Map, each opening
// its list in place. A grilling lists with the card it waits on; tapping that
// card's question line opens the card itself.
import { useMemo, useState } from 'react';
import { Icon, cx } from '../ui';
import { EpicCard } from './BeadCards';
import { NeedCard } from './NeedCard';
import { firstLine, openGrillings, openMaps, type OpenGrilling } from '../model/openLists';
import type { ViewIndex } from '../model/tree';
import { beadHref } from '../nav/route';

function ListChip({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium hover:border-line-strong',
        open ? 'border-line-strong bg-raised text-fg' : 'border-line bg-surface text-muted',
      )}
    >
      {label} · {count}
      <Icon name={open ? 'down' : 'forward'} size={13} />
    </button>
  );
}

function GrillingRow({ entry, index }: { entry: OpenGrilling; index: ViewIndex }) {
  const [open, setOpen] = useState(false);
  const { bead, need } = entry;
  const line = need ? firstLine(need.kind === 'question' ? need.text : '') || need.title || bead.title : '';
  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid="grilling-row">
      <a href={beadHref(bead.id)} className="text-[14.5px] leading-snug font-semibold hover:underline">
        {bead.title}
      </a>
      <span className="font-mono text-[11.5px] text-faint">{bead.id}</span>
      {need ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="flex items-start gap-2 rounded-xl border border-needs/40 bg-needs/10 px-3 py-2 text-left text-[13.5px]"
          >
            <span className="min-w-0 flex-1">{line}</span>
            <Icon name={open ? 'down' : 'forward'} size={14} className="mt-0.5 shrink-0" />
          </button>
          {open && <NeedCard need={need} epicTitle={index.byId.get(need.epic)?.title} index={index} />}
        </>
      ) : (
        <span className="text-[13px] text-muted">No card waiting on you.</span>
      )}
    </li>
  );
}

export function OpenLists({ index }: { index: ViewIndex }) {
  const grillings = useMemo(() => openGrillings(index), [index]);
  const maps = useMemo(() => openMaps(index), [index]);
  const [shown, setShown] = useState<'grillings' | 'maps' | undefined>();
  const toggle = (which: 'grillings' | 'maps') => setShown((was) => (was === which ? undefined : which));
  return (
    <section className="flex flex-col gap-3" aria-label="Open grillings and maps">
      <div className="flex flex-wrap gap-2">
        <ListChip label="Grillings" count={grillings.length} open={shown === 'grillings'} onToggle={() => toggle('grillings')} />
        <ListChip label="Open maps" count={maps.length} open={shown === 'maps'} onToggle={() => toggle('maps')} />
      </div>
      {shown === 'grillings' && (
        <section aria-label="Open grillings">
          {grillings.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {grillings.map((entry) => (
                <GrillingRow key={entry.bead.id} entry={entry} index={index} />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[13px] text-muted">No open grillings.</p>
          )}
        </section>
      )}
      {shown === 'maps' && (
        <section aria-label="Open maps">
          {maps.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {maps.map((bead) => (
                <EpicCard key={bead.id} epic={bead} index={index} />
              ))}
            </div>
          ) : (
            <p className="px-1 text-[13px] text-muted">No open maps.</p>
          )}
        </section>
      )}
    </section>
  );
}
