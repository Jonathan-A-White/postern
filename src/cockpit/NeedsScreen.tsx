// src/cockpit/NeedsScreen.tsx — where the cockpit opens (plans/0021 decision 8):
// the factory's pulse, then everything waiting on the Governor in one queue,
// most blocking first, then anything new from the Mayor he has not read. This
// replaces the old Inbox and Projects' "Needs you" (decision 10).
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, EmptyState, Icon, IconButton, SectionTitle, Segmented, Spinner, TimeAgo } from '../ui';
import { Screen } from './Shell';
import { FactoryPulse } from './FactoryPulse';
import { OpenLists } from './OpenLists';
import { NeedCard } from './NeedCard';
import { LiveCard } from './LiveCard';
import { useAnswers, useCards, useMessages, useUnlockedKey, useViewIndex } from './hooks';
import type { MessageRow } from '../data/db';
import { refreshNow, useLive } from '../services/live';
import { acceptOfferedMayorKey, fingerprint } from '../services/me';
import { isPushSubscribed, pushSupported, rememberPushSubscribed, subscribeToPush } from '../services/push';
import { publicKeyHexFromMasterKey } from '../services/vault';
import { formatRoute, threadHrefFor } from '../nav/route';
import { previewText } from '../model/conversation';
import { needsByWaiter, unsettledNeeds } from '../model/needs';
import type { ViewIndex } from '../model/tree';
import type { WaitsFor } from '../model/view';
import type { LiveCard as LiveCardData } from '../model/cards';
import { navigate } from '../router';
import { toast } from '../ui/toastStore';

function UnreadThreads({ index }: { index?: ViewIndex }) {
  const messages = useMessages();
  const threads = useMemo(() => {
    const latest = new Map<string, { row: MessageRow; count: number }>();
    for (const row of messages) {
      if (row.direction !== 'received' || row.read) continue;
      const key = row.thread ?? 'general';
      const entry = latest.get(key);
      latest.set(key, { row: !entry || row.ts > entry.row.ts ? row : entry.row, count: (entry?.count ?? 0) + 1 });
    }
    return [...latest.entries()].sort((a, b) => b[1].row.ts - a[1].row.ts);
  }, [messages]);
  if (threads.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Unread from the Mayor">
      <SectionTitle>Unread from the Mayor</SectionTitle>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {threads.map(([key, { row, count }]) => {
          const bead = key.startsWith('bead:') ? key.slice(5) : undefined;
          const title = bead ? (index?.byId.get(bead)?.title ?? bead) : key.startsWith('topic:') ? key.slice(6) : 'Factory';
          return (
            <li key={key}>
              <a href={threadHrefFor(key)} className="flex items-start gap-3 px-4 py-3 hover:bg-raised">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[14.5px] font-semibold">{title}</span>
                    <TimeAgo at={row.ts} className="ml-auto shrink-0 text-[12px] text-faint" />
                  </span>
                  <span className="line-clamp-2 text-[13.5px] text-muted">{previewText(row)}</span>
                </span>
                {count > 1 && <span className="mt-0.5 rounded-full bg-raised px-2 text-[11px] text-muted">{count}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NotifyPrompt() {
  const key = useUnlockedKey();
  const [state, setState] = useState<'unknown' | 'on' | 'off' | 'busy'>('unknown');
  useEffect(() => {
    void isPushSubscribed().then((on) => setState(on ? 'on' : 'off'));
  }, []);
  if (!pushSupported() || state !== 'off' || !key) return null;
  async function enable() {
    if (!key) return;
    setState('busy');
    try {
      await subscribeToPush({ publicKeyHex: publicKeyHexFromMasterKey(key), unlockedKey: key });
      await rememberPushSubscribed();
      setState('on');
      toast('Notifications are on');
    } catch (err) {
      setState('off');
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }
  return (
    <Banner tone="ready" icon="bell" action={<Button size="sm" variant="primary" busy={false} onClick={() => void enable()}>Turn on</Button>}>
      Get a notification the moment the Mayor needs you.
    </Banner>
  );
}

/** The live cards (mw-nqur1n.11): those with an item still open under You, and the finished ones under 'Done · N'. */
function LiveCards({ open, finished, titleOf }: { open: LiveCardData[]; finished: LiveCardData[]; titleOf: (bead: string) => string | undefined }) {
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      {open.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Cards">
          <SectionTitle>Cards · {open.length}</SectionTitle>
          <div className="grid gap-3 xl:grid-cols-2">
            {open.map((card) => (
              <LiveCard key={card.id} card={card} titleOf={titleOf} />
            ))}
          </div>
        </section>
      )}
      {finished.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Done cards">
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((was) => !was)}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-muted hover:border-line-strong"
          >
            Done · {finished.length}
            <Icon name={showDone ? 'down' : 'forward'} size={13} />
          </button>
          {showDone && (
            <div className="grid gap-3 xl:grid-cols-2">
              {finished.map((card) => (
                <LiveCard key={card.id} card={card} titleOf={titleOf} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

const EMPTY: Record<WaitsFor, { title: string; text: string }> = {
  you: { title: 'Nothing needs you', text: 'The factory is working on its own. You will get a notification when the Mayor needs a decision.' },
  mayor: { title: 'Nothing waits on the Mayor', text: 'Every card he owes you something on has been dealt with.' },
  factory: { title: 'Nothing waits on the factory', text: 'No card is held back by work still to be done.' },
};

export function NeedsScreen({ who = 'you' }: { who?: WaitsFor }) {
  const view = useViewIndex();
  const live = useLive();
  const answers = useAnswers();
  const [refreshing, setRefreshing] = useState(false);
  const index = view?.index;
  const split = useMemo(() => needsByWaiter(index ? unsettledNeeds(index.view.needs, answers) : []), [index, answers]);
  const needs = split[who];
  const cards = useCards();
  const openCards = useMemo(() => cards.filter((card) => !card.done), [cards]);
  const doneCards = useMemo(() => cards.filter((card) => card.done), [cards]);
  const youCount = split.you.length + openCards.length;
  const choose = (next: WaitsFor) => navigate(formatRoute({ view: 'needs', who: next }), { replace: true });

  async function refresh() {
    setRefreshing(true);
    await refreshNow();
    setRefreshing(false);
  }

  return (
    <Screen
      title="Needs you"
      subtitle={index ? <span>View <TimeAgo at={index.view.written_at} /></span> : undefined}
      actions={<IconButton icon="refresh" label="Refresh" onClick={() => void refresh()} disabled={refreshing} />}
    >
      <div className="flex flex-col gap-5">
        {live.status === 'unlicensed' && (
          <Banner tone="blocked" icon="lock" action={<a className="text-sm font-semibold underline" href={formatRoute({ view: 'key' })}>Open key</a>}>
            This key holds no Postern licence yet.
          </Banner>
        )}
        {live.offeredMayorKey && (
          <Banner
            tone="needs"
            icon="key"
            action={
              <Button size="sm" onClick={() => void acceptOfferedMayorKey().then(() => refreshNow())}>
                Trust it
              </Button>
            }
          >
            The backend names a different Mayor key: {fingerprint(live.offeredMayorKey)}. Messages still go to the one you trusted.
          </Banner>
        )}
        <NotifyPrompt />

        {index && <FactoryPulse index={index} />}
        {index && <OpenLists index={index} />}

        {view === undefined && (
          <div className="flex justify-center py-16 text-muted">
            <Spinner size={22} />
          </div>
        )}

        {view === null && (
          <EmptyState icon="map" title="No view of the factory yet">
            {live.status === 'connecting' ? 'Connecting to the desktop…' : 'It arrives once the backend answers. Pull to refresh or check Me for the connection.'}
          </EmptyState>
        )}

        {who === 'you' && <LiveCards open={openCards} finished={doneCards} titleOf={(bead) => index?.byId.get(bead)?.title} />}

        {index && (
          <section className="flex flex-col gap-3" aria-label="Waiting on you">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{who === 'you' && youCount ? `Waiting on you · ${youCount}` : 'Waiting on you'}</SectionTitle>
              <Segmented<WaitsFor>
                label="Who the cards wait on"
                value={who}
                onChange={choose}
                options={[
                  { value: 'you', label: `You · ${youCount}` },
                  { value: 'mayor', label: `Mayor · ${split.mayor.length}` },
                  { value: 'factory', label: `Factory · ${split.factory.length}` },
                ]}
              />
            </div>
            {needs.length === 0 && (who !== 'you' || openCards.length === 0) ? (
              <div className="rounded-2xl border border-dashed border-line">
                <EmptyState icon="check" title={EMPTY[who].title}>
                  {EMPTY[who].text}
                </EmptyState>
              </div>
            ) : needs.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {needs.map((need) => (
                  <NeedCard key={`${need.kind}:${need.bead}:${need.since}`} need={need} epicTitle={index.byId.get(need.epic)?.title} index={index} />
                ))}
              </div>
            ) : null}
          </section>
        )}

        <UnreadThreads index={index} />
      </div>
    </Screen>
  );
}
