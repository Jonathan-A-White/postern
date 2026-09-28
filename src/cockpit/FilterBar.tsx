// src/cockpit/FilterBar.tsx — the one filter the map and search share (plans/0021
// decisions 9 and 13): words, the board's columns, rigs and hosts, and a name to
// save it under for next time.
import { useState } from 'react';
import { Button, Icon, cx } from '../ui';
import { BUCKETS, type Bucket } from '../model/tree';
import { isEmptyFilter, type BeadFilter } from '../model/filter';
import { saveFilter, useSavedFilters } from './savedFilters';
import { toast } from '../ui/toastStore';

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
        active ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FilterBar({
  filter,
  onChange,
  rigs,
  hosts,
  placeholder = 'Filter by words, id, rig…',
}: {
  filter: BeadFilter;
  onChange: (filter: BeadFilter) => void;
  rigs: string[];
  hosts: string[];
  placeholder?: string;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const saved = useSavedFilters();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await saveFilter({ name: trimmed, filter });
    toast(`Saved “${trimmed}”`);
    setNaming(false);
    setName('');
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="filter-bar">
      <label className="relative block">
        <span className="sr-only">Filter</span>
        <Icon name="filter" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={filter.text}
          onChange={(event) => onChange({ ...filter, text: event.target.value })}
          placeholder={placeholder}
          className="h-10 w-full pl-9"
        />
      </label>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        {saved.map((entry) => (
          <Toggle key={entry.name} active={false} onClick={() => onChange(entry.filter)}>
            <Icon name="flag" size={13} />
            {entry.name}
          </Toggle>
        ))}
        {BUCKETS.map(({ bucket, label }) => (
          <Toggle key={bucket} active={filter.buckets.includes(bucket)} onClick={() => onChange({ ...filter, buckets: toggle<Bucket>(filter.buckets, bucket) })}>
            {label}
          </Toggle>
        ))}
        {rigs.map((rig) => (
          <Toggle key={`rig-${rig}`} active={filter.rigs.includes(rig)} onClick={() => onChange({ ...filter, rigs: toggle(filter.rigs, rig) })}>
            {rig}
          </Toggle>
        ))}
        {hosts.map((host) => (
          <Toggle key={`host-${host}`} active={filter.hosts.includes(host)} onClick={() => onChange({ ...filter, hosts: toggle(filter.hosts, host) })}>
            <Icon name="host" size={13} />
            {host}
          </Toggle>
        ))}
      </div>
      {!isEmptyFilter(filter) && (
        <div className="flex items-center gap-2">
          {naming ? (
            <>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this filter" aria-label="Filter name" className="h-8 flex-1 text-sm" autoFocus />
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={!name.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon="flag" onClick={() => setNaming(true)}>
                Save filter
              </Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => onChange({ text: '', buckets: [], rigs: [], hosts: [], types: [] })}>
                Clear
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
