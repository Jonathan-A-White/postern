// src/cockpit/FactoryPulse.tsx — the factory at a glance (plans/0021 decision 9's
// top zoom level): which hosts are alive, how much is working, ready, blocked,
// held and landed today. Each figure opens the map narrowed to it.
import { Dot, Icon, cx, type Tone } from '../ui';
import { factoryStats, type ViewIndex } from '../model/tree';
import { formatRoute } from '../nav/route';
import { relativeTime } from '../services/age';

const STALE_MS = 20 * 60 * 1000;

function Metric({ label, value, tone, href }: { label: string; value: number; tone: Tone; href: string }) {
  return (
    <a href={href} className="group flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
        <Dot tone={tone} />
        {label}
      </span>
      <span className="text-[22px] leading-none font-semibold tabular-nums">{value}</span>
    </a>
  );
}

export function FactoryPulse({ index, now = new Date() }: { index: ViewIndex; now?: Date }) {
  const stats = factoryStats(index, now);
  const hosts = index.view.hosts;
  const mapHref = (bucket: string) => formatRoute({ view: 'map', bucket });
  return (
    <div className="flex flex-col gap-3" data-testid="factory-pulse">
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Working" value={stats.working} tone="working" href={mapHref('working')} />
        <Metric label="Ready" value={stats.ready} tone="ready" href={mapHref('ready')} />
        <Metric label="Blocked" value={stats.blocked} tone="blocked" href={mapHref('blocked')} />
        <Metric label="Landed today" value={stats.landedToday} tone="done" href={mapHref('done')} />
      </div>
      {hosts.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {hosts.map((host) => {
            const synced = host.last_sync ? new Date(host.last_sync) : undefined;
            const stale = !synced || now.getTime() - synced.getTime() > STALE_MS;
            return (
              <span
                key={host.name}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                  stale ? 'border-blocked/40 text-blocked' : 'border-line text-muted',
                )}
                title={synced ? synced.toLocaleString() : 'never'}
              >
                <Icon name="host" size={14} />
                <span className="font-medium text-fg">{host.name}</span>
                {synced ? relativeTime(synced, now) : 'never'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
