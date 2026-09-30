// src/cockpit/TalkScreen.tsx — every conversation with the Mayor (plans/0021
// decision 10): the factory-wide thread first, then each bead and topic he has
// talked about, most recent first, with what was said last and what is unread.
// Opening one shows it as a conversation with the composer; a bead's thread
// links through to the bead. Two panes on a wide screen. A thread of a finished
// bead, quiet for 3 days, or one he put away, sits under one Archived row
// (mw-2y46l.6); search looks through both. In the Factory thread a post with
// replies shows one 'N replies' row; tapping it (or Reply on any post) opens that
// post's own thread with a Reply… composer (mw-hkg17.2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, TimeAgo, cx } from '../ui';
import { Screen } from './Shell';
import { Conversation, SpeakAll } from './Conversation';
import { Composer } from './Composer';
import { TopicForm } from './TopicForm';
import { topicKey } from './topicKey';
import { useBeadComments, useBeadDetail, useMessages, useThreadArchive, useThreadMessages, useViewIndex, useWide } from './hooks';
import { mergeConversation, type ConversationItem } from '../model/conversation';
import { groupGeneral, type GeneralThread } from '../model/generalThreads';
import { beadHref, formatRoute } from '../nav/route';
import { navigate } from '../router';
import { messagesRepo, settingsRepo } from '../data/repositories';
import { parseThreadKey, type ThreadRef } from '../services/threads';
import { GENERAL, summariseThreads, titleFor, type ThreadSummary } from '../model/threads';

function ThreadRow({ thread, active, onToggleArchive }: { thread: ThreadSummary; active: boolean; onToggleArchive: (thread: ThreadSummary) => void }) {
  return (
    <li className="flex items-center">
      <a
        href={formatRoute({ view: 'talk', thread: thread.key })}
        aria-current={active ? 'true' : undefined}
        className={cx('flex min-w-0 flex-1 items-start gap-3 px-4 py-3 transition-colors', active ? 'bg-raised' : 'hover:bg-raised/60')}
      >
        <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', thread.key === GENERAL ? 'bg-accent/15 text-accent' : 'bg-raised text-muted')}>
          <Icon name={thread.key === GENERAL ? 'layers' : thread.key.startsWith('bead:') ? 'check' : 'talk'} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx('truncate text-[14.5px]', thread.unread ? 'font-semibold' : 'font-medium')}>{thread.title}</span>
            {thread.latest && <TimeAgo at={thread.latest.at} className="ml-auto shrink-0 text-[11.5px] text-faint" />}
          </span>
          <span className="flex items-center gap-2">
            <span className="line-clamp-1 flex-1 text-[13px] text-muted">
              {thread.latest ? `${thread.latest.sent ? 'You: ' : ''}${thread.latest.preview}` : thread.subtitle}
            </span>
            {thread.unread > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-fg">{thread.unread}</span>
            )}
          </span>
        </span>
      </a>
      {thread.key !== GENERAL &&
        (thread.archived ? (
          <Button size="sm" variant="ghost" className="mr-2" aria-label={`Unarchive ${thread.title}`} onClick={() => onToggleArchive(thread)}>
            Unarchive
          </Button>
        ) : (
          <IconButton icon="archive" size="sm" className="mr-2" label={`Archive ${thread.title}`} onClick={() => onToggleArchive(thread)} />
        ))}
    </li>
  );
}

function ThreadList({ threads, current, filter, onToggleArchive }: { threads: ThreadSummary[]; current?: string; filter: string; onToggleArchive: (thread: ThreadSummary) => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const words = filter.trim().toLowerCase();
  const matching = words ? threads.filter((t) => `${t.title} ${t.subtitle}`.toLowerCase().includes(words)) : threads;
  const live = matching.filter((t) => !t.archived);
  const archived = matching.filter((t) => t.archived);
  const rows = (list: ThreadSummary[], testId: string) => (
    <ul className="divide-y divide-line" data-testid={testId}>
      {list.map((thread) => (
        <ThreadRow key={thread.key} thread={thread} active={thread.key === current} onToggleArchive={onToggleArchive} />
      ))}
    </ul>
  );

  // Searching looks through both: what matches, live first, then what matches among the archived.
  if (words) {
    return (
      <>
        {rows(live, 'thread-list')}
        {archived.length > 0 && (
          <>
            <div className="border-y border-line px-4 py-1.5 text-[12px] font-semibold tracking-[0.08em] text-faint uppercase">Archived</div>
            {rows(archived, 'archived-list')}
          </>
        )}
      </>
    );
  }
  if (showArchived && archived.length > 0) {
    return (
      <>
        <button type="button" onClick={() => setShowArchived(false)} className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-left text-sm text-muted hover:bg-raised/60">
          <Icon name="back" size={15} />
          Archived ({archived.length})
        </button>
        {rows(archived, 'archived-list')}
      </>
    );
  }
  return (
    <>
      {rows(live, 'thread-list')}
      {archived.length > 0 && (
        <button type="button" onClick={() => setShowArchived(true)} className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left text-sm text-muted hover:bg-raised/60">
          <Icon name="archive" size={16} />
          <span className="flex-1">Archived ({archived.length})</span>
          <Icon name="forward" size={15} />
        </button>
      )}
    </>
  );
}

function NewTopic() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        New topic
      </Button>
    );
  }
  return (
    <TopicForm
      onStart={(name) => {
        navigate({ view: 'talk', thread: topicKey(name) });
        setOpen(false);
      }}
    />
  );
}

/** Where General was scrolled to when a thread was opened from it, so Back lands at the same place. */
let generalScroll: number | null = null;

function openReplies(rootTxid: string) {
  navigate({ view: 'talk', thread: GENERAL, root: rootTxid });
}

function RepliesRow({ thread, onOpen }: { thread: GeneralThread; onOpen: () => void }) {
  const fresh = thread.replies.some((reply) => reply.unread);
  return (
    <a
      href={formatRoute({ view: 'talk', thread: GENERAL, root: thread.root.txid })}
      onClick={onOpen}
      className="flex items-center gap-1.5 self-start px-1 text-[12.5px] font-semibold text-accent hover:underline"
    >
      <Icon name="talk" size={13} />
      {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
      <span className="font-normal text-faint">·</span>
      <TimeAgo at={thread.lastReplyAt} className="font-normal text-faint" />
      {fresh && <span className="text-accent">· new</span>}
    </a>
  );
}

/** The Factory thread: each post once, with one row for its replies. */
function GeneralPane() {
  const rows = useThreadMessages(undefined);
  const threads = useMemo(() => groupGeneral(mergeConversation(rows)), [rows]);
  const roots = useMemo(() => threads.map((thread) => thread.root), [threads]);
  const byRoot = useMemo(() => new Map(threads.map((thread) => [thread.root.id, thread])), [threads]);
  const scroller = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<{ speaker: string; text: string } | null>(null);
  const remember = () => {
    generalScroll = scroller.current?.scrollTop ?? null;
  };

  useEffect(() => {
    void messagesRepo.markThreadRead(undefined);
  }, [rows.length]);

  useEffect(() => {
    if (generalScroll === null || roots.length === 0 || !scroller.current) return;
    scroller.current.scrollTop = generalScroll;
    generalScroll = null;
  }, [roots.length]);

  return (
    <>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <Conversation
            items={roots}
            onQuote={(item: ConversationItem) => setQuote({ speaker: item.speakerLabel, text: item.text })}
            onReply={(item) => {
              remember();
              if (item.txid) openReplies(item.txid);
            }}
            footer={(item) => {
              const thread = byRoot.get(item.id);
              return thread && thread.replyCount > 0 ? <RepliesRow thread={thread} onOpen={remember} /> : null;
            }}
            empty={<EmptyState icon="talk" title="Nothing said here yet">Say anything; the Mayor answers in this same thread.</EmptyState>}
          />
        </div>
      </div>
      <Composer thread={undefined} quote={quote} onClearQuote={() => setQuote(null)} />
    </>
  );
}

/** One General post with its replies in time order, and a composer that answers it. */
function RepliesPane({ rootTxid }: { rootTxid: string }) {
  const rows = useThreadMessages(undefined);
  const thread = useMemo(() => {
    const wanted = rootTxid.toLowerCase();
    return groupGeneral(mergeConversation(rows)).find((candidate) => candidate.root.txid?.toLowerCase() === wanted);
  }, [rows, rootTxid]);
  const items = useMemo(() => (thread ? [thread.root, ...thread.replies] : []), [thread]);
  const [quote, setQuote] = useState<{ speaker: string; text: string } | null>(null);

  useEffect(() => {
    void messagesRepo.markThreadRead(undefined);
  }, [rows.length]);

  return (
    <>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <Conversation
            items={items}
            onQuote={(item: ConversationItem) => setQuote({ speaker: item.speakerLabel, text: item.text })}
            empty={<EmptyState icon="talk" title="That post is not on this phone">It may still be arriving; Back returns to the Factory thread.</EmptyState>}
          />
        </div>
      </div>
      {thread && <Composer thread={undefined} re={thread.root.txid} textOnly placeholder="Reply…" quote={quote} onClearQuote={() => setQuote(null)} />}
    </>
  );
}

function ThreadPane({ threadKey }: { threadKey: string }) {
  const ref: ThreadRef | undefined = parseThreadKey(threadKey);
  const storeKey = threadKey;
  const rows = useThreadMessages(storeKey);
  const bead = ref && 'bead' in ref ? ref.bead : undefined;
  const { detail } = useBeadDetail(bead);
  const items = useMemo(() => mergeConversation(rows, detail?.comments ?? []), [rows, detail]);
  const [quote, setQuote] = useState<{ speaker: string; text: string } | null>(null);

  useEffect(() => {
    void messagesRepo.markThreadRead(storeKey);
  }, [storeKey, rows.length]);

  return (
    <>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <Conversation
            items={items}
            onQuote={(item: ConversationItem) => setQuote({ speaker: item.speakerLabel, text: item.text })}
            empty={<EmptyState icon="talk" title="Nothing said here yet">Say anything; the Mayor answers in this same thread.</EmptyState>}
          />
        </div>
      </div>
      <Composer thread={ref} quote={quote} onClearQuote={() => setQuote(null)} />
    </>
  );
}

function PaneFor({ threadKey, root }: { threadKey: string; root?: string }) {
  if (threadKey !== GENERAL) return <ThreadPane key={threadKey} threadKey={threadKey} />;
  return root ? <RepliesPane key={`${GENERAL}:${root}`} rootTxid={root} /> : <GeneralPane key={GENERAL} />;
}

export function TalkScreen({ thread, root }: { thread?: string; root?: string }) {
  const wide = useWide();
  const view = useViewIndex();
  const [filter, setFilter] = useState('');
  const current = thread;
  const inReplies = current === GENERAL && root !== undefined;
  const { title, subtitle } = inReplies ? { title: 'Thread', subtitle: 'A post in the Factory thread and its replies' } : current ? titleFor(current, view?.index) : { title: 'Talk', subtitle: '' };
  const bead = current?.startsWith('bead:') ? current.slice(5) : undefined;
  const rows = useThreadMessages(current === GENERAL ? undefined : current);
  const speakItems = useMemo(() => mergeConversation(rows), [rows]);
  const messages = useMessages();
  const choices = useThreadArchive();
  const comments = useBeadComments();
  const threads = useMemo(() => summariseThreads(messages, view?.index, choices, undefined, comments), [messages, view, choices, comments]);
  const currentThread = threads.find((t) => t.key === current);
  const toggleArchive = (thread: ThreadSummary) => {
    void settingsRepo.setThreadArchived(thread.key, !thread.archived);
    if (thread.key === current && !thread.archived) navigate({ view: 'talk' });
  };

  const threadActions = (
    <>
      <SpeakAll items={speakItems} />
      {currentThread && currentThread.key !== GENERAL && (
        <IconButton icon="archive" label={currentThread.archived ? 'Unarchive thread' : 'Archive thread'} onClick={() => toggleArchive(currentThread)} />
      )}
      {bead && <IconButton icon="forward" label="Open the bead" onClick={() => navigate(beadHref(bead))} />}
    </>
  );

  const list = (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <label className="relative flex-1">
          <span className="sr-only">Find a thread</span>
          <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a thread" className="h-9 w-full pl-8 text-sm" />
        </label>
        <NewTopic />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <ThreadList threads={threads} current={current} filter={filter} onToggleArchive={toggleArchive} />
      </div>
    </>
  );

  if (wide) {
    return (
      <Screen title={current ? title : 'Talk'} subtitle={current ? subtitle : 'Every conversation with the Mayor'} actions={current ? threadActions : undefined} bare>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[360px] shrink-0 flex-col border-r border-line">{list}</div>
          <div className="flex min-w-0 flex-1 flex-col">
            {current ? <PaneFor threadKey={current} root={root} /> : <EmptyState icon="talk" title="Pick a conversation">Or start one with the Factory thread.</EmptyState>}
          </div>
        </div>
      </Screen>
    );
  }

  if (current) {
    return (
      <Screen title={title} subtitle={subtitle} back={inReplies ? { view: 'talk', thread: GENERAL } : { view: 'talk' }} actions={threadActions} bare>
        <PaneFor threadKey={current} root={root} />
      </Screen>
    );
  }

  return (
    <Screen title="Talk" subtitle="Every conversation with the Mayor" bare>
      {list}
    </Screen>
  );
}
