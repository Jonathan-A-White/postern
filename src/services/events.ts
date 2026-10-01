// src/services/events.ts — the factory's events (docs/protocol.md §22) on this phone
// (mw-jrx0s.7). The message sync hands back each `events` record's batch; this keeps
// every event once by seq, applies the ones past the cursor in seq order to the stored
// view (so Needs you and the Map re-render through their live queries), fetches the view
// again only on a gap or when an event says something only the home can work out, and
// tells each useEvents subscriber of the events it asked for.
import { useMemo, useSyncExternalStore } from 'react';
import { answersRepo, eventsRepo, messagesRepo, viewRepo } from '../data/repositories';
import { applyBeadDetail, projectEvents, type EventBatch, type FactoryEvent, type Projection } from '../model/events';
import { decodeView } from '../model/view';
import { fetchBeadDetail } from './beads';
import { syncMessages } from './inbox';
import { decodeQuestion, decodeReply, type QuestionBody } from './questions';
import { refreshView } from './view';

export interface ProjectedBatches {
  /** The events applied, in seq order: those past the cursor, each once. */
  applied: FactoryEvent[];
  /** A gap in the seqs, no view to project onto, or an event the copy cannot follow: fetch the view. */
  refetch: boolean;
  /** Beads whose detail (§12) holds what an event named but did not carry. */
  details: string[];
}

async function questionsAndAnswers(events: FactoryEvent[]): Promise<{ questions: Map<string, QuestionBody>; answers: Map<string, string> }> {
  const questions = new Map<string, QuestionBody>();
  const answers = new Map<string, string>();
  const sent = events.some((e) => e.kind === 'card_answered') ? await answersRepo.getAll() : [];
  for (const event of events) {
    if (!event.detail) continue;
    if (event.kind === 'card_asked') {
      const row = await messagesRepo.getByTxid(event.detail);
      const body = row?.plaintext ? decodeQuestion(row.plaintext) : undefined;
      if (body) questions.set(event.detail, body);
    } else if (event.kind === 'card_answered') {
      const mine = sent.find((row) => row.txid === event.detail);
      const row = mine ? undefined : await messagesRepo.getByTxid(event.detail);
      const answer = mine?.answer ?? (row?.plaintext ? decodeReply(row.plaintext)?.answer : undefined);
      if (answer !== undefined) answers.set(event.detail, answer);
    }
  }
  return { questions, answers };
}

/** Applies `events` (in the order given) to the stored view; `refetch` and `details` as projectEvents says. */
async function applyToView(events: FactoryEvent[]): Promise<{ held: boolean; projection: Projection | undefined }> {
  const { questions, answers } = await questionsAndAnswers(events);
  let projection: Projection | undefined;
  const held = await viewRepo.update((plaintext) => {
    try {
      projection = projectEvents(decodeView(plaintext), events, { question: (txid) => questions.get(txid), answer: (txid) => answers.get(txid) });
    } catch {
      return undefined;
    }
    return JSON.stringify(projection.view);
  });
  return { held: Boolean(held), projection: projection as Projection | undefined };
}

/** Keeps each batch's events once by seq and applies those past the cursor to the stored
 * view, in seq order, whatever order the batches came in; moves the cursor to the last.
 * An emergency batch (§22) goes first: it is kept and applied, and heard, before any other
 * batch, out of seq order if need be; its seqs are recorded so the ordinary pass, which
 * still moves the cursor over them, does not apply them a second time. */
export async function projectBatches(batches: EventBatch[]): Promise<ProjectedBatches> {
  const none: ProjectedBatches = { applied: [], refetch: false, details: [] };
  if (batches.length === 0) return none;
  const cursor = await eventsRepo.cursor();
  const result: ProjectedBatches = { applied: [], refetch: false, details: [] };
  const merge = (applied: FactoryEvent[], held: boolean, projection: Projection | undefined) => {
    result.applied.push(...applied);
    result.refetch = result.refetch || !held || !projection || projection.refetch;
    for (const id of projection?.details ?? []) if (!result.details.includes(id)) result.details.push(id);
  };

  const emergency = batches.filter((batch) => batch.lane === 'emergency');
  const early = await eventsRepo.early();
  if (emergency.length > 0) {
    const fresh = await eventsRepo.addNew(emergency.flatMap((batch) => batch.events));
    if (fresh.length > 0) {
      const { held, projection } = await applyToView(fresh);
      for (const event of fresh) if (event.seq > cursor) early.add(event.seq);
      await eventsRepo.setEarly(early);
      publishEvents(fresh);
      merge(fresh, held, projection);
    }
  }

  for (const batch of [...batches].filter((b) => b.lane !== 'emergency').sort((a, b) => a.from - b.from)) await eventsRepo.addNew(batch.events);
  const pending = await eventsRepo.after(cursor);
  if (pending.length === 0) return result.applied.length > 0 ? result : none;

  // A gap: the next event held is not the one after the cursor, or the seqs jump. The
  // events are applied all the same; the view fetched after them fills in what was missed.
  const gap = pending.some((event, i) => event.seq !== (i === 0 ? cursor : pending[i - 1].seq) + 1);
  const ordinary = pending.filter((event) => !early.has(event.seq));
  if (ordinary.length > 0) {
    const { held, projection } = await applyToView(ordinary);
    publishEvents(ordinary);
    merge(ordinary, held, projection);
  }
  const last = pending[pending.length - 1].seq;
  await eventsRepo.setCursor(last);
  if (early.size > 0) await eventsRepo.setEarly([...early].filter((seq) => seq > last));
  result.refetch = result.refetch || gap;
  return result;
}

export interface SyncEventsOptions {
  publicKeyHex: string;
  unlockedKey: Uint8Array;
  mayorKey?: string;
  /** Whether the backend serves /api/view (§15's features). */
  live: boolean;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** The message sync with its events projected: pages the records past the cursor,
 * applies their events, fetches each bead's detail an event asked for, and the view
 * when the events call for it. Resolves whether the view was fetched. */
export async function syncMessagesAndEvents(options: SyncEventsOptions): Promise<{ applied: number; refetched: boolean }> {
  const { publicKeyHex, unlockedKey: key, mayorKey, live, apiBase, fetchImpl } = options;
  const { events } = await syncMessages({ publicKeyHex, unlockedKey: key, mayorKey, apiBase, fetchImpl });
  const projected = await projectBatches(events);
  let refetch = projected.refetch;
  for (const id of projected.details) {
    try {
      const fetched = await fetchBeadDetail(id, { key, mayorKey, apiBase, fetchImpl });
      if (fetched.status === 'ok') await viewRepo.update((plaintext) => JSON.stringify(applyBeadDetail(decodeView(plaintext), fetched.detail)));
      else refetch = true;
    } catch {
      refetch = true;
    }
  }
  if (refetch) await refreshView({ key, mayorKey, live, apiBase, fetchImpl });
  return { applied: projected.applied.length, refetched: refetch };
}

/** What a screen listens for: events of these kinds about these beads, naming these
 * details (a `bead_changed`'s `comment`, say). Any left out (or empty) matches every one. */
export interface EventFilter {
  kinds?: readonly string[];
  beads?: readonly string[];
  details?: readonly string[];
}

const subscribers = new Set<{ filter: EventFilter; listener: (event: FactoryEvent) => void }>();

function matches(filter: EventFilter, event: FactoryEvent): boolean {
  return (
    (!filter.kinds?.length || filter.kinds.includes(event.kind)) &&
    (!filter.beads?.length || filter.beads.includes(event.bead)) &&
    (!filter.details?.length || filter.details.includes(event.detail))
  );
}

/** Calls `listener` with the newest matching event of each applied batch; resolves to the unsubscribe. */
export function subscribeEvents(filter: EventFilter, listener: (event: FactoryEvent) => void): () => void {
  const entry = { filter, listener };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

/** Tells every subscriber whose kinds and beads match: once per call, with the newest match. */
export function publishEvents(events: FactoryEvent[]): void {
  for (const { filter, listener } of [...subscribers]) {
    const match = [...events].reverse().find((event) => matches(filter, event));
    if (match) listener(match);
  }
}

interface EventStore {
  subscribe(notify: () => void): () => void;
  get(): FactoryEvent | undefined;
}

/** One screen's subscription, as useSyncExternalStore reads it: the newest match it has heard. */
function eventStore(filter: EventFilter): EventStore {
  let last: FactoryEvent | undefined;
  return {
    subscribe: (notify) =>
      subscribeEvents(filter, (event) => {
        last = event;
        notify();
      }),
    get: () => last,
  };
}

/** The newest applied event of these kinds about these beads since the screen mounted,
 * re-rendering only when one arrives: the subscription every screen reads. */
export function useEvents(filter: EventFilter): FactoryEvent | undefined {
  const kinds = JSON.stringify(filter.kinds ?? []);
  const beads = JSON.stringify(filter.beads ?? []);
  const details = JSON.stringify(filter.details ?? []);
  const store = useMemo(
    () => eventStore({ kinds: JSON.parse(kinds) as string[], beads: JSON.parse(beads) as string[], details: JSON.parse(details) as string[] }),
    [kinds, beads, details],
  );
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
