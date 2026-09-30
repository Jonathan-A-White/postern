// src/cockpit/ShareScreen.tsx — files shared into Postern from any other app
// (plans/0021 decision 12): what arrived, then where it should go — the factory
// thread, a thread he used lately, or a bead he searches for. Choosing one opens
// that thread with the files already in its composer. 'New topic' comes first, then
// the thread he shared to last, marked 'Last used' (mw-dw0i6.2).
import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Icon, Spinner } from '../ui';
import { Screen } from './Shell';
import { useMessages, useViewIndex } from './hooks';
import { settingsRepo, sharesRepo } from '../data/repositories';
import type { ShareRow } from '../data/db';
import { GENERAL, summariseThreads, titleFor, type ThreadSummary } from '../model/threads';
import { setPendingShare } from './shareInbox';
import { navigate } from '../router';
import { formatRoute } from '../nav/route';
import { matchesText } from '../model/filter';
import { TopicForm } from './TopicForm';
import { topicKey } from './topicKey';

function ThreadChoice({ thread, lastUsed, onChoose }: { thread: ThreadSummary; lastUsed?: boolean; onChoose: (key: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onChoose(thread.key)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
        <Icon name={thread.key === GENERAL ? 'layers' : 'talk'} size={17} className="text-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-[14.5px] font-medium">{thread.title}</span>
            {lastUsed && <span className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] leading-[18px] font-semibold text-accent">Last used</span>}
          </span>
          <span className="block truncate text-[12px] text-faint">{thread.subtitle}</span>
        </span>
      </button>
    </li>
  );
}

export function ShareScreen({ id }: { id?: string }) {
  const [share, setShare] = useState<ShareRow | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const messages = useMessages();
  const view = useViewIndex();
  // undefined until read; null when he has not shared anywhere yet.
  const [lastKey, setLastKey] = useState<string | null | undefined>(undefined);
  const [naming, setNaming] = useState(false);
  const threads = useMemo(() => summariseThreads(messages, view?.index), [messages, view]);
  // The thread he shared to last, even when it has no message yet (a fresh topic); the recents omit it.
  const last = useMemo<ThreadSummary | undefined>(() => {
    if (!lastKey) return undefined;
    return threads.find((thread) => thread.key === lastKey) ?? { key: lastKey, ...titleFor(lastKey, view?.index), unread: 0, archived: false };
  }, [threads, lastKey, view]);
  const recents = useMemo(() => threads.filter((thread) => thread.key !== lastKey).slice(0, 8), [threads, lastKey]);
  const beads = useMemo(
    () => (query.trim() && view ? view.index.view.beads.filter((bead) => bead.status !== 'closed' && matchesText(bead, query)).slice(0, 12) : []),
    [query, view],
  );

  useEffect(() => {
    void (id ? sharesRepo.get(id) : sharesRepo.latest()).then((row) => setShare(row ?? null));
  }, [id]);

  useEffect(() => {
    void settingsRepo.get('lastShareThread').then((value) => setLastKey(typeof value === 'string' ? value : null));
  }, []);

  function sendTo(threadKey: string) {
    if (!share) return;
    void settingsRepo.set('lastShareThread', threadKey);
    setPendingShare({ text: share.text, files: share.files });
    void sharesRepo.remove(share.id);
    navigate(formatRoute({ view: 'talk', thread: threadKey }), { replace: true });
  }

  if (share === undefined || lastKey === undefined) {
    return (
      <Screen title="Share" back={{ view: 'needs' }}>
        <div className="flex justify-center py-16 text-muted">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }
  if (share === null) {
    return (
      <Screen title="Share" back={{ view: 'needs' }}>
        <EmptyState icon="share" title="Nothing waiting to be shared" />
      </Screen>
    );
  }

  return (
    <Screen title="Send to the Mayor" subtitle={`${share.files.length} file${share.files.length === 1 ? '' : 's'}${share.text ? ' and a note' : ''}`} back={{ view: 'needs' }}>
      <div className="flex flex-col gap-5">
        <ul className="flex flex-wrap gap-2">
          {share.files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px]">
              <Icon name={file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'mic' : 'file'} size={16} />
              {file.name}
            </li>
          ))}
        </ul>
        {share.text && <p className="rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] text-muted">{share.text}</p>}

        <section className="flex flex-col gap-2" aria-label="Where to">
          <p className="px-1 text-[12px] font-semibold tracking-wide text-faint uppercase">Where to</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            <li>
              {naming ? (
                <div className="px-4 py-3">
                  <TopicForm onStart={(name) => sendTo(topicKey(name))} />
                </div>
              ) : (
                <button type="button" onClick={() => setNaming(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                  <Icon name="plus" size={17} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">New topic</span>
                    <span className="block truncate text-[12px] text-faint">Name something new to talk about</span>
                  </span>
                </button>
              )}
            </li>
            {last && <ThreadChoice thread={last} lastUsed onChoose={sendTo} />}
            {recents.map((thread) => (
              <ThreadChoice key={thread.key} thread={thread} onChoose={sendTo} />
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2" aria-label="A bead">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Or find a bead…" className="h-11 w-full" />
          {beads.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {beads.map((bead) => (
                <li key={bead.id}>
                  <button type="button" onClick={() => sendTo(`bead:${bead.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium">{bead.title}</span>
                      <span className="block font-mono text-[11.5px] text-faint">{bead.id}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}
