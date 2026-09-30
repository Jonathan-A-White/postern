// src/cockpit/Shell.tsx — the frame every screen sits in (plans/0021 decision
// 9): on a phone, a header and a tab bar along the bottom on every screen (a
// bead or a thread too: the composer sits above it, and only the lowest bar
// keeps the bottom safe-area inset); on a wide screen, a sidebar with the same
// places and room for two panes. isDeep only decides Back, not the tab bar.
import { type ReactNode } from 'react';
import { Banner, Icon, IconButton, cx, type IconName } from '../ui';
import { formatRoute, topViewOf, type Route, type TopView } from '../nav/route';
import { goBack } from '../router';
import { useLive } from '../services/live';
import { hostsToMoveTo, useStandby } from '../services/standby';
import { MoveHomeButtons } from './MoveHome';
import { liveLabel } from './liveLabel';
import { useAnswers, useMessages, useViewIndex, useWide } from './hooks';
import { needsByWaiter, unsettledNeeds } from '../model/needs';

const TABS: { view: TopView; label: string; icon: IconName; route: Route }[] = [
  { view: 'needs', label: 'Needs you', icon: 'needs', route: { view: 'needs' } },
  { view: 'map', label: 'Map', icon: 'map', route: { view: 'map' } },
  { view: 'talk', label: 'Talk', icon: 'talk', route: { view: 'talk' } },
  { view: 'search', label: 'Search', icon: 'search', route: { view: 'search' } },
  { view: 'me', label: 'Me', icon: 'me', route: { view: 'me' } },
];

function useBadges(): Partial<Record<TopView, number>> {
  const view = useViewIndex();
  const messages = useMessages();
  const answers = useAnswers();
  const unread = messages.filter((row) => row.direction === 'received' && !row.read).length;
  return { needs: view ? needsByWaiter(unsettledNeeds(view.index.view.needs, answers)).you.length : 0, talk: unread };
}

export function LiveBadge({ compact }: { compact?: boolean }) {
  const live = useLive();
  const { text, tone } = liveLabel(live);
  const dot = { working: 'bg-working', needs: 'bg-needs', blocked: 'bg-blocked', neutral: 'bg-faint' }[tone];
  return (
    <a
      href={formatRoute({ view: 'me' })}
      title={live.error ?? text}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-muted hover:text-fg"
      data-testid="live-badge"
    >
      <span className={cx('h-2 w-2 rounded-full', dot, live.status === 'live' && 'animate-live')} aria-hidden="true" />
      <span className={cx(compact && 'max-w-[5.5rem] truncate')}>{compact ? text.split(' · ')[0] : text}</span>
    </a>
  );
}

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[11px] leading-[18px] font-semibold text-accent-fg tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TabBar({ current }: { current: TopView }) {
  const badges = useBadges();
  return (
    <nav aria-label="Places" className="pb-safe shrink-0 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((tab) => {
          const active = tab.view === current;
          return (
            <li key={tab.view} className="flex-1">
              <a
                href={formatRoute(tab.route)}
                aria-current={active ? 'page' : undefined}
                className={cx('relative flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium', active ? 'text-fg' : 'text-faint')}
              >
                <span className="relative">
                  <Icon name={tab.icon} size={22} strokeWidth={active ? 2.1 : 1.7} />
                  {badges[tab.view] ? (
                    <span className="absolute -top-1.5 left-3.5">
                      <Badge count={badges[tab.view]} />
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar({ current }: { current: TopView }) {
  const badges = useBadges();
  return (
    <nav aria-label="Places" className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <Icon name="key" size={18} strokeWidth={2.2} />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold">Postern</p>
          <p className="text-[11px] text-faint">The Governor's cockpit</p>
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 px-3">
        {TABS.map((tab) => {
          const active = tab.view === current;
          return (
            <li key={tab.view}>
              <a
                href={formatRoute(tab.route)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors',
                  active ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
                )}
              >
                <Icon name={tab.icon} size={19} />
                <span className="flex-1">{tab.label}</span>
                <Badge count={badges[tab.view]} />
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto p-4">
        <LiveBadge />
      </div>
    </nav>
  );
}

/** The API answered 503 standby: the host that answered is not home, so the
 * home is down (or moving). Whatever screen he is on, he can move it (mw-43v9x.9). */
function HomeDown() {
  const standby = useStandby();
  if (!standby) return null;
  return (
    <section aria-label="Home is down" className="shrink-0 px-2 pt-2">
      <Banner tone="blocked" icon="alarm">
        <div className="flex flex-col gap-2">
          <span className="font-medium">Home is down</span>
          <MoveHomeButtons hosts={hostsToMoveTo(standby.home)} />
        </div>
      </Banner>
    </section>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const wide = useWide();
  const top = topViewOf(route);
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-fg">
      {wide && <Sidebar current={top} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <HomeDown />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        {!wide && <TabBar current={top} />}
      </div>
    </div>
  );
}

export interface ScreenProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Where Back goes when the page was not reached by an in-app move. */
  back?: Route;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Let the body manage its own scrolling (two-pane layouts, conversations). */
  bare?: boolean;
  className?: string;
}

/** One screen: a sticky header, a scrolling body, an optional footer. */
export function Screen({ title, subtitle, back, actions, children, footer, bare, className }: ScreenProps) {
  const wide = useWide();
  return (
    <section className={cx('flex min-h-0 flex-1 flex-col', className)}>
      <header className="pt-safe shrink-0 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="flex h-14 items-center gap-1 px-2 lg:px-5">
          {back ? <IconButton icon="back" label="Back" onClick={() => goBack(back)} /> : <span className="w-2 lg:hidden" />}
          <div className="min-w-0 flex-1 px-1">
            <h1 className="truncate text-[17px] leading-tight font-semibold">{title}</h1>
            {subtitle && <div className="truncate text-[12px] text-muted">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1">
            {actions}
            {!wide && !back && <LiveBadge compact />}
          </div>
        </div>
      </header>
      {bare ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-8 lg:py-6">{children}</div>
        </div>
      )}
      {footer}
    </section>
  );
}
