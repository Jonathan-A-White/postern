// src/cockpit/BeadScreen.tsx — one bead, zoomed all the way in (plans/0021
// decisions 7, 9 and 10): where it sits in the tree, its state and path, what
// it waits on and what waits on it, its description and acceptance, anything it
// needs from him, the one-tap actions that fit its state, and its whole
// conversation — every comment and every Postern message — with a composer
// pinned to it. Two columns on a wide screen.
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Chip, Dot, EmptyState, Icon, IconButton, SectionTitle, Spinner, TimeAgo, cx } from '../ui';
import { Markdown } from '../markdown';
import { Screen } from './Shell';
import { Conversation, SpeakAll } from './Conversation';
import { Composer } from './Composer';
import { NeedCard } from './NeedCard';
import { useBeadDetail, useThreadMessages, useViewIndex, useWide } from './hooks';
import { useOneTap } from './oneTap';
import { WaitingNote } from './WaitingNote';
import { StaleChoice } from './StaleChoice';
import { ancestors, BUCKET_LABEL, BUCKET_TONE, bucketOf, isEpic, type ViewIndex } from '../model/tree';
import { mergeConversation, type ConversationItem } from '../model/conversation';
import type { BeadDetail, BeadPath, ViewBead } from '../model/view';
import { beadHref, formatRoute } from '../nav/route';
import { messagesRepo } from '../data/repositories';
import { sendAction, useSend } from './send';
import { priorityLabel, priorityTone, statusWord, typeIcon } from './labels';
import { speak } from '../services/speech';

function RelationChips({ ids, index, label }: { ids: string[]; index?: ViewIndex; label: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold text-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const bead = index?.byId.get(id);
          const bucket = bead && index ? bucketOf(bead, index) : undefined;
          return (
            <a key={id} href={beadHref(id)} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] hover:border-line-strong">
              {bucket && <Dot tone={BUCKET_TONE[bucket]} />}
              <span className="font-mono text-faint">{id}</span>
              {bead && <span className="truncate">{bead.title}</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function PathGrid({ path, attempts }: { path?: BeadPath; attempts: number }) {
  if (!path && attempts === 0) return null;
  const cells: [string, string][] = [
    ['Rig', path?.rig ?? ''],
    ['Branch', path?.branch ?? ''],
    ['Host', path?.host ?? ''],
    ['Model', path?.model ?? ''],
    ['Effort', path?.effort ?? ''],
    ['Formula', path?.formula ?? ''],
    ['Attempts', attempts ? String(attempts) : ''],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3">
      {cells
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11.5px] text-faint">{label}</dt>
            <dd className="truncate font-mono text-[13px]">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function Actions({ bead, detail, index }: { bead?: ViewBead; detail?: BeadDetail; index?: ViewIndex }) {
  const { busy, run } = useSend();
  const status = detail?.status ?? bead?.status ?? '';
  const id = detail?.id ?? bead?.id ?? '';
  const priority = detail?.priority ?? bead?.priority ?? 2;
  const claimed = !!(detail?.assignee ?? bead?.assignee);
  const epic = bead && index ? isEpic(bead, index) : detail?.type === 'epic';
  const release = useOneTap(id, 'release');
  const hold = useOneTap(id, 'hold');
  const verified = useOneTap(id, 'verified');
  const verify = index?.needsByBead.get(id)?.some((need) => need.kind === 'verify');
  const stale = index?.needsByBead.get(id)?.some((need) => need.kind === 'stale');
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Actions">
      {status === 'deferred' &&
        (release.waiting ? (
          <WaitingNote />
        ) : (
          <Button size="sm" variant="primary" icon="release" busy={busy} onClick={() => void release.tap(() => sendAction({ action: 'release', bead: id }), `Released ${id}`)}>
            Release
          </Button>
        ))}
      {epic && (
        <a href={formatRoute({ view: 'map', focus: id })} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-sm hover:border-line-strong">
          <Icon name="map" size={16} />
          Open on the map
        </a>
      )}
      {status === 'open' &&
        !claimed &&
        !epic &&
        (hold.waiting ? (
          <WaitingNote />
        ) : (
          <Button size="sm" icon="hold" busy={busy} onClick={() => void hold.tap(() => sendAction({ action: 'hold', bead: id }), `Held ${id}`)}>
            Hold
          </Button>
        ))}
      {verify &&
        (verified.waiting ? (
          <WaitingNote />
        ) : (
          <Button size="sm" variant="primary" icon="check" busy={busy} onClick={() => void verified.tap(() => sendAction({ action: 'verified', bead: id }), `Marked ${id} verified`)}>
            Verified
          </Button>
        ))}
      {stale && id && <StaleChoice bead={id} size="sm" />}
      {status !== 'closed' && id && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised pr-1 pl-2.5 text-sm">
          <Icon name="flag" size={15} className="text-muted" />
          <span className="sr-only">Priority</span>
          <select
            value={priority}
            disabled={busy}
            onChange={(event) => {
              const next = Number(event.target.value);
              void run(() => sendAction({ action: 'priority', bead: id, priority: next }), `${id} is now P${next}`);
            }}
            className="h-7 border-0 bg-transparent py-0 pr-1 pl-0 text-sm"
          >
            {[0, 1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                P{p}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Details({ id, bead, detail, index, status }: { id: string; bead?: ViewBead; detail?: BeadDetail; index?: ViewIndex; status: string }) {
  const [showAcceptance, setShowAcceptance] = useState(false);
  const title = detail?.title ?? bead?.title ?? id;
  const type = detail?.type ?? bead?.type ?? 'task';
  const bucket = bead && index ? bucketOf(bead, index) : undefined;
  const chain = index ? ancestors(id, index) : [];
  const needs = index?.needsByBead.get(id) ?? [];
  const waits = detail?.waits ?? bead?.waits ?? [];
  const blocks = detail?.blocks.length ? detail.blocks : (index?.waitedOnBy.get(id) ?? []);
  const children = detail?.children.length ? detail.children : (index?.children.get(id)?.map((b) => b.id) ?? []);
  const description = detail?.description ?? bead?.summary ?? '';
  const priority = detail?.priority ?? bead?.priority ?? 2;

  return (
    <div className="flex flex-col gap-5">
      {chain.length > 0 && (
        <nav aria-label="Where this is" className="no-scrollbar flex items-center gap-1 overflow-x-auto text-[12.5px] text-muted">
          <a href={formatRoute({ view: 'map' })} className="shrink-0 hover:text-fg">
            Factory
          </a>
          {chain.map((ancestor) => (
            <span key={ancestor.id} className="flex shrink-0 items-center gap-1">
              <Icon name="forward" size={12} className="text-faint" />
              <a href={formatRoute({ view: 'map', focus: ancestor.id })} className="max-w-[14rem] truncate hover:text-fg">
                {ancestor.title}
              </a>
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-2.5">
        <h2 className="text-[21px] leading-snug font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip mono>{id}</Chip>
          <Chip icon={typeIcon(type)}>{type}</Chip>
          {bucket ? <Chip tone={BUCKET_TONE[bucket]}>{BUCKET_LABEL[bucket]}</Chip> : <Chip>{statusWord(detail?.status ?? '')}</Chip>}
          <Chip tone={priorityTone(priority)}>{priorityLabel(priority)}</Chip>
          {(detail?.labels ?? bead?.labels ?? []).map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
        </div>
        <p className="text-[12.5px] text-faint">
          {detail?.closed || bead?.closed ? (
            <>
              Closed <TimeAgo at={detail?.closed || bead?.closed} />
            </>
          ) : (
            <>
              Updated <TimeAgo at={detail?.updated || bead?.updated} />
            </>
          )}
          {(detail?.assignee || bead?.assignee) && <> · claimed by {detail?.assignee || bead?.assignee}</>}
        </p>
      </div>

      <Actions bead={bead} detail={detail} index={index} />

      {needs.map((need) => (
        <NeedCard key={`${need.kind}:${need.since}`} need={need} compact />
      ))}

      <PathGrid path={detail?.path ?? bead?.path} attempts={detail?.attempts ?? bead?.attempts ?? 0} />

      <section className="flex flex-col gap-2" aria-label="Description">
        <SectionTitle
          action={description ? <IconButton icon="speaker" label="Read the description aloud" size="sm" onClick={() => speak(`${title}. ${description}`)} /> : undefined}
        >
          Description
        </SectionTitle>
        {description ? (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <Markdown text={description} />
          </div>
        ) : (
          <p className="px-1 text-sm text-faint">{status === 'loading' ? 'Loading…' : 'No description.'}</p>
        )}
        {detail?.acceptance && (
          <div className="rounded-2xl border border-line bg-surface">
            <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px] font-semibold" onClick={() => setShowAcceptance((v) => !v)} aria-expanded={showAcceptance}>
              Acceptance criteria
              <Icon name="down" size={16} className={cx('transition-transform', showAcceptance && 'rotate-180')} />
            </button>
            {showAcceptance && (
              <div className="border-t border-line px-4 py-3">
                <Markdown text={detail.acceptance} />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Relations">
        <RelationChips ids={waits} index={index} label="Waits on" />
        <RelationChips ids={blocks} index={index} label="Blocks" />
        <RelationChips ids={children} index={index} label="Inside" />
      </section>
    </div>
  );
}

export function BeadScreen({ id }: { id: string }) {
  const view = useViewIndex();
  const wide = useWide();
  const index = view?.index;
  const bead = index?.byId.get(id);
  const { detail, status, error, refresh } = useBeadDetail(id);
  const threadKey = `bead:${id}`;
  const rows = useThreadMessages(threadKey);
  const items = useMemo(() => mergeConversation(rows, detail?.comments ?? []), [rows, detail]);
  const [quote, setQuote] = useState<{ speaker: string; text: string } | null>(null);

  useEffect(() => {
    void messagesRepo.markThreadRead(threadKey);
  }, [threadKey, rows.length]);

  const onQuote = (item: ConversationItem) => setQuote({ speaker: item.speakerLabel, text: item.text });
  const title = detail?.title ?? bead?.title ?? id;
  const back = bead?.parent ? { view: 'map' as const, focus: bead.parent } : { view: 'map' as const };

  if (!bead && !detail && (status === 'loading' || status === 'idle')) {
    return (
      <Screen title={id} back={back}>
        <div className="flex justify-center py-16 text-muted">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }
  if (!bead && !detail) {
    return (
      <Screen title={id} back={back}>
        <EmptyState icon="search" title={status === 'missing' ? 'No such bead' : 'Not in the live view'}>
          {status === 'unsupported' ? 'This backend cannot fetch one bead yet (docs/protocol.md §12).' : (error ?? 'It may have closed more than a week ago.')}
        </EmptyState>
      </Screen>
    );
  }

  const detailsPane = (
    <>
      {status === 'error' && (
        <div className="mb-4">
          <Banner tone="blocked" icon="alarm" action={<Button size="sm" onClick={refresh}>Retry</Button>}>
            {error}
          </Banner>
        </div>
      )}
      <Details id={id} bead={bead} detail={detail} index={index} status={status} />
    </>
  );

  const conversation = (
    <Conversation
      items={items}
      onQuote={onQuote}
      scrollOnOpen={wide}
      empty={
        <p className="py-6 text-center text-sm text-faint">
          No conversation yet. Anything you say here is written to {id} and reaches the Mayor at once.
        </p>
      }
    />
  );
  const composer = <Composer thread={{ bead: id }} placeholder={`Say something about ${id}…`} quote={quote} onClearQuote={() => setQuote(null)} />;
  const actions = <SpeakAll items={items} />;

  if (wide) {
    return (
      <Screen title={title} subtitle={id} back={back} actions={actions} bare>
        <div className="flex min-h-0 flex-1">
          <div className="scroll-thin min-w-0 flex-1 overflow-y-auto border-r border-line px-8 py-6">
            <div className="mx-auto max-w-3xl">{detailsPane}</div>
          </div>
          <div className="flex w-[440px] shrink-0 flex-col xl:w-[520px]">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] font-semibold text-muted">
              <Icon name="talk" size={16} />
              Conversation
              <span className="text-faint">{items.length}</span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">{conversation}</div>
            {composer}
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={title} subtitle={id} back={back} actions={actions} bare footer={composer}>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detailsPane}
        <div className="mt-6 flex flex-col gap-3">
          <SectionTitle>Conversation · {items.length}</SectionTitle>
          {conversation}
        </div>
      </div>
    </Screen>
  );
}
