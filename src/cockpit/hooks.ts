// src/cockpit/hooks.ts — how screens read the cockpit's data: straight from
// Dexie through live queries, so whatever src/services/live.ts writes (a new
// message, a changed view) re-renders every screen showing it, with no screen
// fetching on its own.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { AnswerRow, ArchiveChoices, BeadDetailRow, EventRow, MessageRow, OutboxRow, ViewRow } from '../data/db';
import { answersRepo, beadDetailsRepo, eventsRepo, messagesRepo, outboxRepo, settingsRepo, viewRepo } from '../data/repositories';
import { decodeBeadDetail, decodeView, type BeadComment, type BeadDetail } from '../model/view';
import { indexView, type ViewIndex } from '../model/tree';
import { getKey, onKeyChange } from '../services/keySession';
import { fetchBeadDetail } from '../services/beads';
import { threadKey } from '../services/threads';
import { getLiveState } from '../services/live';
import { useEvents } from '../services/events';

export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(next),
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
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
  const row = useLiveQuery<ViewRow | null | undefined>(() => viewRepo.get().then((r) => r ?? null), [], undefined);
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

/** The newest emergency event (§22) he has not tapped away; undefined when there is none. */
export function useEmergency(): EventRow | undefined {
  return useLiveQuery(() => eventsRepo.latestEmergency(), [], undefined);
}

/** Every stored message, oldest first. */
export function useMessages(): MessageRow[] {
  return useLiveQuery(() => messagesRepo.getAllOldestFirst(), [], [] as MessageRow[]);
}

/** The Talk line's turns, oldest first (class `talk`, docs/protocol.md §20). */
export function useTalkTurns(): MessageRow[] {
  return useLiveQuery(() => messagesRepo.talkTurns(), [], [] as MessageRow[]);
}

/** The ring he last opened the Talk line from (docs/protocol.md §21), or undefined. */
export function useAnsweredRing(): string | undefined {
  return useLiveQuery(() => settingsRepo.get('answeredRing').then((value) => (typeof value === 'string' ? value : undefined)), [], undefined as string | undefined);
}

/** The call records and Talk-line turns, oldest first (docs/protocol.md §21): what says whether a Call me has been answered. */
export function useCallLine(): MessageRow[] {
  return useLiveQuery(() => messagesRepo.callLine(), [], [] as MessageRow[]);
}

export function useThreadMessages(threadKey: string | undefined): MessageRow[] {
  return useLiveQuery(() => messagesRepo.inThread(threadKey), [threadKey], [] as MessageRow[]);
}

/** What he archived or brought back by hand in Talk, on this device. */
export function useThreadArchive(): ArchiveChoices {
  return useLiveQuery(() => settingsRepo.getThreadArchive(), [], {} as ArchiveChoices);
}

/** Every answer and action he has sent, for settling the Needs-you queue at once. */
export function useAnswers(): AnswerRow[] {
  return useLiveQuery(() => answersRepo.getAll(), [], [] as AnswerRow[]);
}

/** Everything he did that has not yet been seen coming back (mw-jrx0s.10): pending and sent rows, oldest first. */
export function useOutbox(): OutboxRow[] {
  return useLiveQuery(() => outboxRepo.open(), [], [] as OutboxRow[]);
}

export type DetailStatus = 'idle' | 'loading' | 'ok' | 'missing' | 'unsupported' | 'error';

/** One bead's full detail: the stored copy at once, then a fresh fetch. */
export function useBeadDetail(id: string | undefined): { detail?: BeadDetail; status: DetailStatus; error?: string; refresh: () => void } {
  const key = useUnlockedKey();
  const stored = useLiveQuery<BeadDetailRow | null>(() => (id ? beadDetailsRepo.get(id).then((r) => r ?? null) : Promise.resolve(null)), [id], null);
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

/** The stored comments of every bead whose detail this phone holds, by its thread key
 * ('bead:<id>'): the same comments useBeadDetail hands a thread screen. */
export function useBeadComments(): ReadonlyMap<string, BeadComment[]> {
  const rows = useLiveQuery(() => beadDetailsRepo.getAll(), [], [] as BeadDetailRow[]);
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
