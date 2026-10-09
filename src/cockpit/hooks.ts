// src/cockpit/hooks.ts — how screens read the cockpit's data: straight from
// Dexie through live queries, so whatever src/services/live.ts writes (a new
// message, a changed view) re-renders every screen showing it, with no screen
// fetching on its own.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { AnswerRow, ArchiveChoices, BeadDetailRow, CardRow, EventRow, MessageRow, OutboxRow, ViewRow } from '../data/db';
import { answersRepo, bannerMsLeft, beadDetailsRepo, cardsRepo, eventsRepo, messagesRepo, outboxRepo, settingsRepo, viewRepo } from '../data/repositories';
import { liveCard, type LiveCard } from '../model/cards';
import { splitArchive } from '../model/cardArchive';
import { useNow } from '../ui/useNow';
import { decodeBeadDetail, decodeView, type BeadComment, type BeadDetail } from '../model/view';
import { indexView, type ViewIndex } from '../model/tree';
import { getKey, onKeyChange } from '../services/keySession';
import { fetchBeadDetail } from '../services/beads';
import { threadKey } from '../services/threads';
import { getLiveState } from '../services/live';
import { useEvents } from '../services/events';
import { recallRead, rememberRead } from './lastKnown';

/** A live query over Dexie. With `remember` (a name for what is read, unique to its deps) the result is also kept
 * in memory (lastKnown.ts), and a screen that mounts, or a name that changes, shows it until its own first read arrives. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T, remember?: string): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => {
        if (remember !== undefined) rememberRead(remember, next);
        setValue(next);
      },
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const known = remember !== undefined ? recallRead<T>(remember) : undefined;
  return known?.known ? (known.value as T) : value;
}

/** The unlocked key, re-rendering when it is set, dropped or lapses. */
export function useUnlockedKey(): Uint8Array | null {
  return useSyncExternalStore(onKeyChange, getKey, getKey);
}

export interface ViewState {
  index: ViewIndex;
  fetchedAt: number;
  source: 'live' | 'snapshot';
}

/** The stored view as a walkable tree; undefined until the first one arrives. */
export function useViewIndex(): ViewState | undefined | null {
  const row = useLiveQuery<ViewRow | null | undefined>(() => viewRepo.get().then((r) => r ?? null), [], undefined, 'view');
  return useMemo(() => {
    if (row === undefined) return undefined;
    if (row === null) return null;
    try {
      return { index: indexView(decodeView(row.plaintext)), fetchedAt: row.fetchedAt, source: row.source };
    } catch {
      return null;
    }
  }, [row]);
}

/** Every bead's title by id, for the speaker to say a bead's title in place of its id (mw-gq6.224). */
export function useBeadTitles(): ReadonlyMap<string, string> {
  const view = useViewIndex();
  return useMemo(() => new Map([...(view?.index.byId ?? [])].map(([id, bead]) => [id, bead.title])), [view]);
}

/** The newest emergency event (§22) he has not tapped away and that is not over; undefined when there is none.
 * An information emergency leaves by itself ten minutes after its time (mw-gq6.277), so the query runs again then. */
export function useEmergency(): EventRow | undefined {
  const [again, setAgain] = useState(0);
  const emergency = useLiveQuery(() => eventsRepo.latestEmergency(), [again], undefined, 'emergency');
  useEffect(() => {
    const left = emergency ? bannerMsLeft(emergency) : undefined;
    if (left === undefined) return;
    const timer = setTimeout(() => setAgain((n) => n + 1), Math.max(left, 0) + 100);
    return () => clearTimeout(timer);
  }, [emergency]);
  return emergency;
}

/** The emergency events held, newest first, for the Emergency screen. */
export function useRecentEmergencies(limit = 20): EventRow[] | undefined {
  return useLiveQuery(() => eventsRepo.recentEmergencies(limit), [limit], undefined as EventRow[] | undefined, `emergencies:${limit}`);
}

/** How many emergency events the phone holds; 0 until they have been read. */
export function useEmergencyCount(): number {
  return useLiveQuery(() => eventsRepo.emergencyCount(), [], 0);
}

/** Every stored message, oldest first. */
export function useMessages(): MessageRow[] {
  return useLiveQuery(() => messagesRepo.getAllOldestFirst(), [], [] as MessageRow[], 'messages');
}

/** The Talk line's turns, oldest first (class `talk`, docs/protocol.md §20); undefined until they have been read. */
export function useTalkTurns(): MessageRow[] | undefined {
  return useLiveQuery(() => messagesRepo.talkTurns(), [], undefined as MessageRow[] | undefined);
}

/** The ring he last opened the Talk line from (docs/protocol.md §21), or undefined. */
export function useAnsweredRing(): string | undefined {
  return useLiveQuery(() => settingsRepo.get('answeredRing').then((value) => (typeof value === 'string' ? value : undefined)), [], undefined as string | undefined);
}

/** The call records and Talk-line turns, oldest first (docs/protocol.md §21): what says whether a Call me has been answered. */
export function useCallLine(): MessageRow[] {
  return useLiveQuery(() => messagesRepo.callLine(), [], [] as MessageRow[]);
}

/** One thread's messages, oldest first. `held` are the messages the screen already has in memory: until
 * the first read of this thread arrives they are what shows, so an opened channel is never painted empty
 * while the phone holds its posts. */
export function useThreadMessages(threadKey: string | undefined, held?: readonly MessageRow[]): MessageRow[] {
  const read = useLiveQuery(() => messagesRepo.inThread(threadKey).then((rows) => ({ threadKey, rows })), [threadKey], undefined as { threadKey: string | undefined; rows: MessageRow[] } | undefined);
  const seed = useMemo(() => (held ? messagesRepo.heldInThread(held, threadKey) : []), [held, threadKey]);
  return read && read.threadKey === threadKey ? read.rows : seed;
}

/** Every live card (§24) as it now reads, newest first. */
export function useCards(): LiveCard[] {
  const rows = useLiveQuery(() => cardsRepo.getAll(), [], [] as CardRow[], 'cards');
  return useMemo(() => rows.map(liveCard).filter((card): card is LiveCard => card !== undefined).sort((a, b) => b.sentAt - a.sentAt), [rows]);
}

/** The live cards split at 48 h untouched (mw-v1uyku.1): the fresh ones for Needs you, the archived ones newest touch first.
 * A message that names one of a card's beads counts as a touch. Nothing is deleted. */
export function useCardArchive(): { fresh: LiveCard[]; archived: LiveCard[] } {
  const cards = useCards();
  const messages = useMessages();
  const at = useNow(60_000);
  return useMemo(() => splitArchive(cards, messages, at), [cards, messages, at]);
}

/** What he archived or brought back by hand in Talk, on this device. */
export function useThreadArchive(): ArchiveChoices {
  return useLiveQuery(() => settingsRepo.getThreadArchive(), [], {} as ArchiveChoices, 'threadArchive');
}

/** Every answer and action he has sent, for settling the Needs-you queue at once. */
export function useAnswers(): AnswerRow[] {
  return useLiveQuery(() => answersRepo.getAll(), [], [] as AnswerRow[], 'answers');
}

/** Everything he did that has not yet been seen coming back (mw-jrx0s.10): pending and sent rows, oldest first. */
export function useOutbox(): OutboxRow[] {
  return useLiveQuery(() => outboxRepo.open(), [], [] as OutboxRow[]);
}

export type DetailStatus = 'idle' | 'loading' | 'ok' | 'missing' | 'unsupported' | 'error';

/** One bead's full detail: the stored copy at once, then a fresh fetch. */
export function useBeadDetail(id: string | undefined): { detail?: BeadDetail; status: DetailStatus; error?: string; refresh: () => void } {
  const key = useUnlockedKey();
  const stored = useLiveQuery<BeadDetailRow | null>(() => (id ? beadDetailsRepo.get(id).then((r) => r ?? null) : Promise.resolve(null)), [id], null, `beadDetail:${id ?? ''}`);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ token: string; status: DetailStatus; error?: string }>();
  const token = `${id ?? ''}|${attempt}`;
  // A comment added to this bead (§22): its text is in the bead's detail alone, so the open page fetches it again, in
  // place (the status stays as it was, so the page does not flash a spinner). A message needs no fetch: it is in the thread's records.
  const commented = useEvents({ kinds: ['bead_changed'], beads: [id ?? ''], details: ['comment'] })?.seq ?? 0;

  useEffect(() => {
    if (!key || !id) return;
    let cancelled = false;
    fetchBeadDetail(id, { key, mayorKey: getLiveState().mayorKey })
      .then((fetched) => {
        if (!cancelled) setResult({ token, status: fetched.status });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ token, status: 'error', error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, key, token, commented]);

  const detail = useMemo(() => {
    if (!stored) return undefined;
    try {
      return decodeBeadDetail(stored.plaintext);
    } catch {
      return undefined;
    }
  }, [stored]);

  const status: DetailStatus = !id || !key ? 'idle' : result?.token === token ? result.status : 'loading';
  return { detail, status, error: result?.token === token ? result.error : undefined, refresh: () => setAttempt((n) => n + 1) };
}

/** The stored comments of one bead (its detail, whenever this phone last fetched it): none until it has been. */
export function useStoredComments(id: string): BeadComment[] {
  const row = useLiveQuery<BeadDetailRow | null>(() => (id ? beadDetailsRepo.get(id).then((r) => r ?? null) : Promise.resolve(null)), [id], null, `beadDetail:${id ?? ''}`);
  return useMemo(() => {
    if (!row) return [];
    try {
      return decodeBeadDetail(row.plaintext).comments;
    } catch {
      return [];
    }
  }, [row]);
}

/** The stored comments of every bead whose detail this phone holds, by its thread key
 * ('bead:<id>'): the same comments useBeadDetail hands a thread screen. */
export function useBeadComments(): ReadonlyMap<string, BeadComment[]> {
  const rows = useLiveQuery(() => beadDetailsRepo.getAll(), [], [] as BeadDetailRow[], 'beadDetails');
  return useMemo(() => {
    const byThread = new Map<string, BeadComment[]>();
    for (const row of rows) {
      try {
        byThread.set(threadKey({ bead: row.id }) as string, decodeBeadDetail(row.plaintext).comments);
      } catch {
        // an undecodable copy shows no comments, as useBeadDetail does
      }
    }
    return byThread;
  }, [rows]);
}

/** Whether the viewport is wide enough for two panes (the `lg` breakpoint). */
export function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.('change', listener);
      return () => list.removeEventListener?.('change', listener);
    },
    get,
    () => false,
  );
}
