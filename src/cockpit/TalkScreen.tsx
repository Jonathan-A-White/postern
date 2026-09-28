// src/cockpit/TalkScreen.tsx — every conversation with the Mayor (plans/0021
// decision 10): the factory-wide thread first, then each bead and topic he has
// talked about, most recent first, with what was said last and what is unread.
// Opening one shows it as a conversation with the composer; a bead's thread
// links through to the bead. Two panes on a wide screen.
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, TimeAgo, cx } from '../ui';
import { Screen } from './Shell';
import { Conversation, SpeakAll } from './Conversation';
import { Composer } from './Composer';
import { useBeadDetail, useMessages, useThreadMessages, useViewIndex, useWide } from './hooks';
import { mergeConversation, previewText, type ConversationItem } from '../model/conversation';
import { beadHref, formatRoute } from '../nav/route';
import { navigate } from '../router';
import { messagesRepo } from '../data/repositories';
import { parseThreadKey, type ThreadRef } from '../services/threads';
import { GENERAL, summariseThreads, titleFor } from '../model/threads';

function ThreadList({ current, filter }: { current?: string; filter: string }) {
  const messages = useMessages();
  const view = useViewIndex();
  const threads = useMemo(() => summariseThreads(messages, view?.index), [messages, view]);
  const words = filter.trim().toLowerCase();
  const shown = words ? threads.filter((t) => `${t.title} ${t.subtitle}`.toLowerCase().includes(words)) : threads;
  return (
    <ul className="divide-y divide-line" data-testid="thread-list">
      {shown.map((thread) => {
        const active = thread.key === current;
        return (
          <li key={thread.key}>
            <a
              href={formatRoute({ view: 'talk', thread: thread.key })}
              aria-current={active ? 'true' : undefined}
              className={cx('flex items-start gap-3 px-4 py-3 transition-colors', active ? 'bg-raised' : 'hover:bg-raised/60')}
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
          </li>
        );
      })}
    </ul>
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

  const threadActions = (
    <>
      <SpeakAll items={speakItems} />
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
        <ThreadList current={current} filter={filter} />
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
