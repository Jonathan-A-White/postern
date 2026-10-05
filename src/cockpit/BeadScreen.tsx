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
import { RepliesRow } from './RepliesRow';
import { NeedCard } from './NeedCard';
import { ThreadCards } from './LiveCard';
import { shareTitle } from '../model/shareText';
import { StepUnderComment } from './HandsSteps';
import { useAnswers, useBeadDetail, useBeadTitles, useOutbox, useThreadMessages, useViewIndex, useWide } from './hooks';
import { pendingMessageItems } from '../model/outbox';
import { useOneTap } from './oneTap';
import { WaitingNote } from './WaitingNote';
import { StaleChoice } from './StaleChoice';
import { VerifiedButton } from './VerifiedButton';
import { StampSection } from './StampSection';
import { howToCheckItemId } from '../model/verified';
import { ancestors, BUCKET_LABEL, BUCKET_TONE, bucketOf, epicStats, isEpic, type ViewIndex } from '../model/tree';
import { mergeConversation, type ConversationItem } from '../model/conversation';
import { groupPosts } from '../model/postThreads';
import { detailAsOf } from '../model/events';
import { unsettledNeeds, waitsFor, waitsOnLinks } from '../model/needs';
import { hasDispatchPath, type BeadDetail, type BeadPath, type ViewBead } from '../model/view';
import { beadHref, formatRoute } from '../nav/route';
import { goBack, navigate } from '../router';
import { takeRestoredBead } from '../nav/lastRoute';
import { useScrollMemory } from '../nav/scrollMemory';
import { sendAction, useSend } from './send';
import { priorityLabel, priorityTone, statusWord, typeIcon } from './labels';
import { speak, stop as stopSpeaking } from '../services/speech';
import { useSpeaking } from './useSpeaking';
import { markThreadSeen } from '../services/seen';

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
  // An epic's Release is the Map's Release N held, offered only while a story under it is held, whatever the epic's own status.
  const held = bead && index && epic ? epicStats(id, index).counts.held : 0;
  // Release un-holds a bead for dispatch, which needs a rig and a target branch: no path, no Release.
  const canRelease = hasDispatchPath(detail?.path ?? bead?.path);
  const hasStories = (detail?.children.length ?? 0) > 0 || (index?.children.get(id)?.length ?? 0) > 0;
  const verify = index?.needsByBead.get(id)?.some((need) => need.kind === 'verify');
  const stale = index?.needsByBead.get(id)?.some((need) => need.kind === 'stale');
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Actions">
      {!epic &&
        status === 'deferred' &&
        canRelease &&
        (release.waiting ? (
          <WaitingNote />
        ) : (
          <Button size="sm" variant="primary" icon="release" busy={busy} onClick={() => void release.tap(() => sendAction({ action: 'release', bead: id }), `Released ${id}`)}>
            Release
          </Button>
        ))}
      {epic &&
        held > 0 &&
        (release.waiting ? (
          <WaitingNote />
        ) : (
          <Button size="sm" variant="primary" icon="release" busy={busy} onClick={() => void release.tap(() => sendAction({ action: 'release', bead: id }), `Released ${id}`)}>
            Release {held} held
          </Button>
        ))}
      {epic && status === 'deferred' && !hasStories && <p className="text-[13px] text-muted">No stories yet: the Mayor drafts them.</p>}
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
      {verify && id && <VerifiedButton bead={id} where="page" size="sm" />}
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
  const titles = useBeadTitles();
  const speakKey = `bead:${id}`;
  const reading = useSpeaking(speakKey);
  const [showAcceptance, setShowAcceptance] = useState(false);
  const title = detail?.title ?? bead?.title ?? id;
  const type = detail?.type ?? bead?.type ?? 'task';
  const bucket = bead && index ? bucketOf(bead, index) : undefined;
  const chain = index ? ancestors(id, index) : [];
  // What he has answered or acted on since it was raised is gone from here as it is from Needs you.
  const answers = useAnswers();
  const needs = unsettledNeeds(index?.needsByBead.get(id) ?? [], answers);
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
        <NeedCard key={`${need.kind}:${need.since}`} need={need} compact index={index} status={detail?.status} />
      ))}

      <PathGrid path={detail?.path ?? bead?.path} attempts={detail?.attempts ?? bead?.attempts ?? 0} />

      <StampSection rig={(detail?.path ?? bead?.path)?.rig ?? ''} comments={detail?.comments ?? []} />

      <section className="flex flex-col gap-2" aria-label="Description">
        <SectionTitle
          action={
            description ? (
              <IconButton
                icon={reading ? 'stop' : 'speaker'}
                label={reading ? 'Stop reading' : 'Read the description aloud'}
                size="sm"
                onClick={() => (reading ? stopSpeaking() : speak(`${title}. ${description}`, { titles, key: speakKey }))}
              />
            ) : undefined
          }
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
  // A phone scrolls details and conversation as one page; a wide screen scrolls them as two.
  const rememberPage = useScrollMemory('page');
  const rememberDetails = useScrollMemory('details');
  const rememberConversation = useScrollMemory('conversation');
  const index = view?.index;
  const bead = index?.byId.get(id);
  const { detail: fetched, status, error, refresh } = useBeadDetail(id);
  // The view moves on event by event; the detail was fetched once: what the view heard since is the newer.
  const detail = useMemo(() => detailAsOf(fetched, bead), [fetched, bead]);
  const threadId = id;
  const threadKey = `bead:${id}`;
  const rows = useThreadMessages(threadKey);
  const outbox = useOutbox();
  // His messages still on their way (mw-jrx0s.10) read as his own, marked pending.
  const items = useMemo(() => [...mergeConversation(rows, detail?.comments ?? []), ...pendingMessageItems(outbox, rows, (thread) => thread === threadKey)], [rows, detail, outbox, threadKey]);
  // Posts once, each with one 'N replies' row: its replies are read in its thread on Talk.
  const threads = useMemo(() => groupPosts(items), [items]);
  const posts = useMemo(() => threads.map((thread) => thread.root), [threads]);
  const byRoot = useMemo(() => new Map(threads.map((thread) => [thread.root.id, thread])), [threads]);
  const [quote, setQuote] = useState<{ speaker: string; text: string } | null>(null);

  useEffect(() => {
    void markThreadSeen(threadKey);
  }, [threadKey, rows.length]);

  // A comment that is a hands step ('HANDS STEP <id> on <host> as <as>:') gets that step's Run under it, when the view lists the step for him.
  const answers = useAnswers();
  const stepUnder = (item: ConversationItem) => {
    const id = /^HANDS STEP (\S+) on /.exec(item.text.trimStart())?.[1];
    if (!id) return null;
    const need = unsettledNeeds(index?.needsByBead.get(threadId) ?? [], answers).find((n) => n.kind === 'hands' && n.steps.some((s) => s.id === id));
    const step = need?.steps.find((s) => s.id === id);
    if (!need || !step) return null;
    const notReady = waitsFor(need) !== 'you' || need.not_ready === true;
    return <StepUnderComment bead={threadId} step={step} waitsOn={notReady ? waitsOnLinks(need, index, beadHref) : undefined} />;
  };
  // The Verified button sits under the newest post carrying HOW TO CHECK IT while the story waits to be verified.
  const howToId = useMemo(() => howToCheckItemId(posts), [posts]);
  const verifyOpen = unsettledNeeds(index?.needsByBead.get(threadId) ?? [], answers).some((n) => n.kind === 'verify');
  const verifiedUnder = (item: ConversationItem) =>
    verifyOpen && item.id === howToId ? (
      <div data-testid="verified-under-how-to">
        <VerifiedButton bead={threadId} where="channel" size="sm" />
      </div>
    ) : null;
  const onQuote = (item: ConversationItem) => setQuote({ speaker: item.speakerLabel, text: item.text });
  const title = detail?.title ?? bead?.title ?? id;
  // Opened cold the view index may not hold the bead yet: the fetched detail knows its parent too.
  const parent = bead?.parent ?? detail?.parent;
  const back = parent ? { view: 'map' as const, focus: parent } : { view: 'map' as const };

  // Opened again where he left it (src/nav/lastRoute.ts), a bead that no longer exists is skipped: Back to the screen
  // before it in his history, or the Map when there is none.
  const gone = !bead && !detail && status === 'missing';
  const found = !!(bead || detail);
  useEffect(() => {
    if (found) takeRestoredBead(id);
    else if (gone && takeRestoredBead(id)) goBack({ view: 'map' });
  }, [found, gone, id]);

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

  const messages = (
    <Conversation
      items={posts}
      shareTitle={shareTitle(title)}
      onQuote={onQuote}
      onReply={(item) => {
        if (item.txid) navigate({ view: 'talk', thread: threadKey, root: item.txid });
      }}
      footer={(item) => {
        const thread = byRoot.get(item.id);
        const run = stepUnder(item);
        return (
          <>
            {run}
            {verifiedUnder(item)}
            {thread && thread.replyCount > 0 ? <RepliesRow channel={threadKey} thread={thread} /> : null}
          </>
        );
      }}
      scrollOnOpen={wide}
      empty={
        <p className="py-6 text-center text-sm text-faint">
          No conversation yet. Anything you say here is written to {id} and reaches the Mayor at once.
        </p>
      }
    />
  );
  const conversation = (
    <>
      <ThreadCards threadKey={threadKey} shareTitle={shareTitle(title)} />
      {messages}
    </>
  );
  const composer = <Composer thread={{ bead: id }} placeholder={`Say something about ${id}…`} quote={quote} onClearQuote={() => setQuote(null)} />;
  const actions = (
    <>
      <SpeakAll items={items} />
      <IconButton icon="mic" label="Talk" onClick={() => navigate({ view: 'line', about: { kind: 'bead', id, title } })} />
    </>
  );

  if (wide) {
    return (
      <Screen title={title} subtitle={id} back={back} actions={actions} bare>
        <div className="flex min-h-0 flex-1">
          <div ref={rememberDetails} className="scroll-thin min-w-0 flex-1 overflow-y-auto border-r border-line px-8 py-6">
            <div className="mx-auto max-w-3xl">{detailsPane}</div>
          </div>
          <div className="flex w-[440px] shrink-0 flex-col xl:w-[520px]">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] font-semibold text-muted">
              <Icon name="talk" size={16} />
              Conversation
              <span className="text-faint">{items.length}</span>
            </div>
            <div ref={rememberConversation} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">{conversation}</div>
            {composer}
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={title} subtitle={id} back={back} actions={actions} bare footer={composer}>
      <div ref={rememberPage} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detailsPane}
        <div className="mt-6 flex flex-col gap-3">
          <SectionTitle>Conversation · {items.length}</SectionTitle>
          {conversation}
        </div>
      </div>
    </Screen>
  );
}
