// src/cockpit/BeadCards.tsx — how a bead shows in a list or on a board, and how
// an epic shows as a card with its progress (plans/0021 decision 9): enough to
// read its state at a glance — column, path, attempts, what it waits on — and
// one tap to zoom in.
import { Chip, Dot, Icon, TimeAgo, cx } from '../ui';
import { BUCKETS, BUCKET_TONE, bucketOf, epicStats, isEpic, isMap, type ViewIndex } from '../model/tree';
import type { ViewBead } from '../model/view';
import { beadHref, formatRoute } from '../nav/route';
import { priorityLabel, priorityTone, typeIcon } from './labels';

export function ProgressBar({ counts, total, className }: { counts: Record<string, number>; total: number; className?: string }) {
  if (total === 0) return <div className={cx('h-1.5 rounded-full bg-sunken', className)} />;
  return (
    <div className={cx('flex h-1.5 overflow-hidden rounded-full bg-sunken', className)} role="img" aria-label={`${counts.done ?? 0} of ${total} done`}>
      {BUCKETS.map(({ bucket, tone }) => {
        const n = counts[bucket] ?? 0;
        if (!n) return null;
        const bg = { needs: 'bg-needs', working: 'bg-working', ready: 'bg-ready', blocked: 'bg-blocked', held: 'bg-held', done: 'bg-done', neutral: 'bg-faint', danger: 'bg-danger' }[tone];
        return <span key={bucket} className={bg} style={{ width: `${(n / total) * 100}%` }} />;
      })}
    </div>
  );
}

export function EpicCard({ epic, index }: { epic: ViewBead; index: ViewIndex }) {
  const stats = epicStats(epic.id, index);
  const counts = { ...stats.counts, done: stats.done };
  const map = isMap(epic);
  return (
    <a
      href={formatRoute({ view: 'map', focus: epic.id })}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
      data-testid="epic-card"
    >
      <div className="flex items-start gap-3">
        <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', map ? 'bg-accent/15 text-accent' : 'bg-raised text-muted')}>
          <Icon name={typeIcon(epic.type, map)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] leading-snug font-semibold group-hover:underline">{epic.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
            <span className="font-mono">{epic.id}</span>
            {stats.rigs.slice(0, 3).map((rig) => (
              <span key={rig}>· {rig}</span>
            ))}
            {stats.lastActivity && (
              <span>
                · <TimeAgo at={stats.lastActivity} />
              </span>
            )}
          </p>
        </div>
        {stats.needs > 0 && (
          <Chip tone="needs" icon="needs">
            {stats.needs}
          </Chip>
        )}
      </div>
      <ProgressBar counts={counts} total={stats.total} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-medium text-fg tabular-nums">
          {stats.done}/{stats.total} done
        </span>
        {BUCKETS.filter((b) => b.bucket !== 'done' && stats.counts[b.bucket] > 0).map((b) => (
          <span key={b.bucket} className="inline-flex items-center gap-1 tabular-nums">
            <Dot tone={b.tone} />
            {stats.counts[b.bucket]} {b.label.toLowerCase()}
          </span>
        ))}
      </div>
    </a>
  );
}

export function PathChips({ bead, dense }: { bead: ViewBead; dense?: boolean }) {
  const path = bead.path;
  if (!path) return null;
  const items = dense ? [path.host, path.model] : [path.rig, path.host, path.model, path.effort];
  return (
    <>
      {items.filter(Boolean).map((item, i) => (
        <Chip key={`${item}-${i}`}>{item}</Chip>
      ))}
    </>
  );
}

export function BeadCard({ bead, index, dense }: { bead: ViewBead; index: ViewIndex; dense?: boolean }) {
  const bucket = bucketOf(bead, index);
  const epic = isEpic(bead, index);
  const waiting = bead.waits.filter((id) => index.byId.get(id)?.status !== 'closed');
  return (
    <a
      href={epic ? formatRoute({ view: 'map', focus: bead.id }) : beadHref(bead.id)}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong"
      data-testid="bead-card"
    >
      <div className="flex items-start gap-2">
        <Dot tone={BUCKET_TONE[bucket]} className="mt-1.5" pulse={bucket === 'working'} />
        <p className={cx('min-w-0 flex-1 text-[14px] leading-snug font-medium', bucket === 'done' && 'text-muted')}>{bead.title}</p>
        {epic && <Icon name="layers" size={15} className="mt-0.5 shrink-0 text-faint" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-4 text-[11.5px] text-faint">
        <span className="font-mono">{bead.id}</span>
        {bead.priority <= 1 && <Chip tone={priorityTone(bead.priority)}>{priorityLabel(bead.priority)}</Chip>}
        {!dense && <PathChips bead={bead} dense />}
        {bead.attempts > 1 && <Chip tone="blocked">try {bead.attempts}</Chip>}
        {waiting.length > 0 && <span>waits on {waiting.length}</span>}
        {bead.comments > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Icon name="talk" size={12} />
            {bead.comments}
          </span>
        )}
      </div>
    </a>
  );
}

export function BeadRow({ bead, index }: { bead: ViewBead; index: ViewIndex }) {
  const bucket = bucketOf(bead, index);
  const epic = isEpic(bead, index);
  return (
    <a
      href={epic ? formatRoute({ view: 'map', focus: bead.id }) : beadHref(bead.id)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-raised"
      data-testid="bead-row"
    >
      <Dot tone={BUCKET_TONE[bucket]} pulse={bucket === 'working'} />
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[14.5px]', bucket === 'done' ? 'text-muted' : 'font-medium')}>{bead.title}</span>
        <span className="flex gap-2 text-[11.5px] text-faint">
          <span className="font-mono">{bead.id}</span>
          {bead.path?.rig && <span>{bead.path.rig}</span>}
          {bead.path?.host && <span>{bead.path.host}</span>}
        </span>
      </span>
      {epic ? <Icon name="layers" size={16} className="text-faint" /> : <TimeAgo at={bead.updated || bead.closed} className="shrink-0 text-[12px] text-faint" />}
    </a>
  );
}
