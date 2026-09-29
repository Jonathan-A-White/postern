// src/cockpit/TalkScreen.tsx — every conversation with the Mayor (plans/0021
// decision 10): the factory-wide thread first, then each bead and topic he has
// talked about, most recent first, with what was said last and what is unread.
// Opening one shows it as a conversation with the composer; a bead's thread
// links through to the bead. Two panes on a wide screen. A thread of a finished
// bead, quiet for 3 days, or one he put away, sits under one Archived row
// (mw-2y46l.6); search looks through both.
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, TimeAgo, cx } from '../ui';
import { Screen } from './Shell';
import { Conversation, SpeakAll } from './Conversation';
import { Composer } from './Composer';
import { useBeadDetail, useMessages, useThreadArchive, useThreadMessages, useViewIndex, useWide } from './hooks';
import { mergeConversation, previewText, type ConversationItem } from '../model/conversation';
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
            {thread.last && <TimeAgo at={thread.last.ts} className="ml-auto shrink-0 text-[11.5px] text-faint" />}
          </span>
          <span className="flex items-center gap-2">
            <span className="line-clamp-1 flex-1 text-[13px] text-muted">
              {thread.last ? `${thread.last.direction === 'sent' ? 'You: ' : ''}${previewText(thread.last)}` : thread.subtitle}
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
  const [name, setName] = useState('');
  if (!open) {
    return (
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        New topic
      </Button>
    );
  }
  const start = () => {
    const topic = name.trim();
    if (!topic) return;
    navigate({ view: 'talk', thread: `topic:${topic}` });
    setName('');
    setOpen(false);
  };
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="What about?" aria-label="New topic" className="h-8 flex-1 text-sm" autoFocus />
      <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
        Start
      </Button>
    </form>
  );
}

function ThreadPane({ threadKey }: { threadKey: string }) {
  const ref: ThreadRef | undefined = threadKey === GENERAL ? undefined : parseThreadKey(threadKey);
  const storeKey = threadKey === GENERAL ? undefined : threadKey;
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

export function TalkScreen({ thread }: { thread?: string }) {
  const wide = useWide();
  const view = useViewIndex();
  const [filter, setFilter] = useState('');
  const current = thread;
  const { title, subtitle } = current ? titleFor(current, view?.index) : { title: 'Talk', subtitle: '' };
  const bead = current?.startsWith('bead:') ? current.slice(5) : undefined;
  const rows = useThreadMessages(current === GENERAL ? undefined : current);
  const speakItems = useMemo(() => mergeConversation(rows), [rows]);
  const messages = useMessages();
  const choices = useThreadArchive();
  const threads = useMemo(() => summariseThreads(messages, view?.index, choices), [messages, view, choices]);
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
            {current ? <ThreadPane key={current} threadKey={current} /> : <EmptyState icon="talk" title="Pick a conversation">Or start one with the Factory thread.</EmptyState>}
          </div>
        </div>
      </Screen>
    );
  }

  if (current) {
    return (
      <Screen title={title} subtitle={subtitle} back={{ view: 'talk' }} actions={threadActions} bare>
        <ThreadPane key={current} threadKey={current} />
      </Screen>
    );
  }

  return (
    <Screen title="Talk" subtitle="Every conversation with the Mayor" bare>
      {list}
    </Screen>
  );
}
