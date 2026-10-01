// src/model/events.ts — the factory's events (docs/protocol.md §22; millwright's
// docs/events.md, which wins where the two differ) as typed data, and the projector:
// each event applied to this phone's own copy of the live view (§11), so a screen
// changes the moment the event arrives rather than when the view is next written.
// What an event cannot tell (a new bead, a card the home builds from text the event
// does not carry) it says, so the caller fetches the view or that bead's detail again.
import type { EventRow } from '../data/db';
import type { QuestionBody } from '../services/questions';
import type { BeadDetail, Need, View, ViewBead } from './view';

export type FactoryEvent = EventRow;

export interface EventBatch {
  from: number;
  to: number;
  lane: string;
  events: FactoryEvent[];
}

/** docs/events.md: the kinds a screen subscribes to. */
export const EVENT_KINDS = ['bead_changed', 'card_asked', 'card_answered', 'card_applied', 'message', 'talk_turn', 'hands_ran', 'mail', 'job'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function seqOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** docs/events.md writes RFC 3339; §22's example, Unix seconds. Either reads as RFC 3339. */
function timeOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return '';
}

/** Parses a decrypted `events` plaintext. A batch with no seq range is refused; an event
 * with no seq or kind is left out; the rest come back in seq order. */
export function decodeEventBatch(text: string): EventBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The events record is not JSON.');
  }
  const raw = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const from = seqOf(raw.from);
  const to = seqOf(raw.to);
  if (from === undefined || to === undefined || !Array.isArray(raw.events)) throw new Error('The events record names no seq range.');
  const lane = str(raw.lane);
  const events: FactoryEvent[] = [];
  for (const item of raw.events) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    const seq = seqOf(e.seq);
    const kind = str(e.kind);
    if (seq === undefined || kind === '') continue;
    events.push({ seq, ts: timeOf(e.ts), kind, bead: str(e.bead), actor: str(e.actor), from: str(e.from), to: str(e.to), detail: str(e.detail), lane: str(e.lane) || lane });
  }
  events.sort((a, b) => a.seq - b.seq);
  return { from, to, lane, events };
}

/** The tracker's status (§11) for a state of the bead machine (docs/events.md): held is
 * deferred; claimed, running, refused and landed are a bead in progress; verified leaves
 * the status as it was. */
const STATUS_OF: Record<string, string> = {
  held: 'deferred',
  open: 'open',
  claimed: 'in_progress',
  running: 'in_progress',
  refused: 'in_progress',
  landed: 'in_progress',
  closed: 'closed',
};

/** The card kinds a bead's closing settles; `verify` is the one a closing raises. */
const SETTLED_BY_CLOSING = new Set<Need['kind']>(['question', 'approve', 'hands', 'demo', 'stale', 'alarm']);

/** What the projector needs from records this phone already holds: a question's body
 * (card_asked names the question's txid) and an answer's words (card_answered names its). */
export interface ProjectionLookups {
  question(txid: string): QuestionBody | undefined;
  answer(txid: string): string | undefined;
}

export interface Projection {
  view: View;
  /** The events said something this copy cannot work out: fetch the view again. */
  refetch: boolean;
  /** Beads whose detail (§12) holds what the event did not carry: a changed field, a RAN step. */
  details: string[];
}

function epicOf(view: View, bead: ViewBead): string {
  const byId = new Map(view.beads.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let at = bead.parent ? byId.get(bead.parent) : undefined;
  while (at && !seen.has(at.id)) {
    if (at.type === 'epic') return at.id;
    seen.add(at.id);
    at = at.parent ? byId.get(at.parent) : undefined;
  }
  return bead.parent ?? '';
}

/** §11's order: most blocking first, then oldest. */
function insertNeed(needs: Need[], need: Need): Need[] {
  const at = needs.findIndex((n) => n.blocks < need.blocks || (n.blocks === need.blocks && n.since > need.since));
  return at < 0 ? [...needs, need] : [...needs.slice(0, at), need, ...needs.slice(at)];
}

/** A bead closed: its own cards are settled, nothing waits on it any more, and a card
 * that waited only on it is ready, when the event can tell (a demo, or a hands card
 * with its steps written). Resolves false when a freed card's next turn is unknown. */
function close(view: View, bead: ViewBead): { view: View; known: boolean } {
  let known = true;
  const beads = view.beads.map((b) => (b.waits.includes(bead.id) ? { ...b, waits: b.waits.filter((id) => id !== bead.id) } : b));
  const needs: Need[] = [];
  for (const need of view.needs) {
    if (need.bead === bead.id && SETTLED_BY_CLOSING.has(need.kind)) continue;
    const waitingOn = need.waiting_on ?? [];
    if (!waitingOn.includes(bead.title)) {
      needs.push(need);
      continue;
    }
    const left = waitingOn.filter((title) => title !== bead.title);
    if (left.length > 0) needs.push({ ...need, waiting_on: left });
    else if (need.kind === 'demo' || (need.kind === 'hands' && need.steps.length > 0)) needs.push({ ...need, waits_for: 'you', not_ready: false, waiting_on: [] });
    else {
      known = false;
      needs.push(need);
    }
  }
  return { view: { ...view, beads, needs }, known };
}

function replaceBead(view: View, bead: ViewBead): View {
  return { ...view, beads: view.beads.map((b) => (b.id === bead.id ? bead : b)) };
}

function beadChanged(view: View, event: FactoryEvent, out: { refetch: boolean; details: string[] }): View {
  const bead = view.beads.find((b) => b.id === event.bead);
  const wasClosed = event.from === 'closed' || event.from === 'verified';
  const closes = event.to === 'closed';
  if (!bead) {
    // A new bead, or one reopened from outside the view, belongs on the map; anything else outside it (a mail bead, an old one) does not.
    if (event.from === '' || (wasClosed && !closes)) out.refetch = true;
    return view;
  }
  const at = event.ts || bead.updated;
  if (event.from === event.to) {
    // A change that left the status alone: a comment adds one to the count; a field's new value is in the bead's detail.
    if (event.detail === 'comment') return replaceBead(view, { ...bead, comments: bead.comments + 1, updated: at });
    if (!out.details.includes(bead.id)) out.details.push(bead.id);
    return replaceBead(view, { ...bead, updated: at });
  }
  // Reopened, held (an approve card may follow) or landed (a verify card may follow): the home builds those cards.
  if ((wasClosed && !closes) || event.to === 'held' || event.to === 'landed') out.refetch = true;
  let next = view;
  if (event.to === 'verified') next = { ...next, needs: next.needs.filter((n) => !(n.kind === 'verify' && n.bead === bead.id)) };
  const status = STATUS_OF[event.to] ?? bead.status;
  const moved: ViewBead = {
    ...bead,
    status,
    updated: at,
    started: event.to === 'claimed' && !bead.started ? at : bead.started,
    closed: status === 'closed' ? bead.closed || at : '',
  };
  next = replaceBead(next, moved);
  if (status === 'closed' && bead.status !== 'closed') {
    const closed = close(next, moved);
    next = closed.view;
    if (!closed.known) out.refetch = true;
    // A story that closes may raise a verify card, built from its HOW TO CHECK IT section.
    if (bead.type !== 'epic') out.refetch = true;
  }
  return next;
}

function cardAsked(view: View, event: FactoryEvent, lookups: ProjectionLookups, out: { refetch: boolean }): View {
  if (view.needs.some((n) => n.kind === 'question' && n.bead === event.bead && !n.answered)) return view;
  const body = lookups.question(event.detail);
  const bead = view.beads.find((b) => b.id === event.bead);
  if (!body || !bead) {
    out.refetch = true;
    return view;
  }
  const need: Need = {
    kind: 'question',
    bead: bead.id,
    epic: epicOf(view, bead),
    title: bead.title,
    since: event.ts,
    text: body.q,
    recommended: body.rec,
    options: body.options,
    blocks: 0,
    steps: [],
    waits_for: 'you',
    not_ready: false,
    waiting_on: [],
  };
  return { ...view, needs: insertNeed(view.needs, need) };
}

function cardAnswered(view: View, event: FactoryEvent, lookups: ProjectionLookups): View {
  const index = view.needs.findIndex((n) => n.kind === 'question' && n.bead === event.bead && !n.answered);
  if (index < 0) return view;
  const needs = [...view.needs];
  needs[index] = { ...needs[index], answered: { option: lookups.answer(event.detail) ?? '', at: event.ts } };
  return { ...view, needs };
}

/** His answer applied: the card leaves, as the view would drop it. That is the answered
 * card, or, with none marked answered here, every question on the bead asked by then. */
function cardApplied(view: View, event: FactoryEvent): View {
  const asked = (n: Need) => n.kind === 'question' && n.bead === event.bead;
  const answered = view.needs.some((n) => asked(n) && n.answered);
  const by = Date.parse(event.ts);
  const settled = (n: Need) => asked(n) && (answered ? n.answered !== undefined : Number.isNaN(by) || !(Date.parse(n.since) > by));
  return { ...view, needs: view.needs.filter((n) => !settled(n)) };
}

function bumpComments(view: View, id: string): View {
  const bead = view.beads.find((b) => b.id === id);
  return bead ? replaceBead(view, { ...bead, comments: bead.comments + 1 }) : view;
}

/** Applies `events`, in the order given (the caller's seq order), to a copy of `view`. */
export function projectEvents(view: View, events: FactoryEvent[], lookups: ProjectionLookups): Projection {
  const out = { refetch: false, details: [] as string[] };
  let next = view;
  for (const event of events) {
    switch (event.kind) {
      case 'bead_changed':
        next = beadChanged(next, event, out);
        break;
      case 'card_asked':
        next = cardAsked(next, event, lookups, out);
        break;
      case 'card_answered':
        next = cardAnswered(next, event, lookups);
        break;
      case 'card_applied':
        next = cardApplied(next, event);
        break;
      case 'message':
        if (event.bead) next = bumpComments(next, event.bead);
        break;
      case 'hands_ran':
        // The step's outcome (its exit and host) is in the RAN comment on the bead, not the event.
        if (next.needs.some((n) => n.kind === 'hands' && n.bead === event.bead) && !out.details.includes(event.bead)) out.details.push(event.bead);
        break;
      default:
        // talk_turn, mail and job change nothing in the view.
        break;
    }
  }
  return { view: next, ...out };
}

/** §17's RAN comment: `RAN step <id> on <host> as <as>, exit <n> …` (millwright's posternrun.go). */
const RAN = /^RAN step (\S+) on (\S+) as \S+, exit (-?\d+)/;

/** A bead's fresh detail (§12) into the view: the fields an event names but does not
 * carry (its title, labels, priority, …), and each hands step's newest RAN line. */
export function applyBeadDetail(view: View, detail: BeadDetail): View {
  const bead = view.beads.find((b) => b.id === detail.id);
  if (!bead) return view;
  const ran = new Map<string, { at: string; exit: number; host: string }>();
  for (const comment of detail.comments) {
    const match = RAN.exec(comment.text);
    if (match) ran.set(match[1], { at: comment.at, exit: Number(match[3]), host: match[2] });
  }
  const beads = view.beads.map((b) =>
    b.id === detail.id
      ? {
          ...b,
          title: detail.title,
          type: detail.type,
          status: detail.status,
          priority: detail.priority,
          labels: detail.labels,
          assignee: detail.assignee,
          waits: detail.waits,
          updated: detail.updated || b.updated,
          started: detail.started,
          closed: detail.closed,
          attempts: detail.attempts,
          comments: detail.comments.length,
        }
      : b,
  );
  const needs = view.needs.map((need) => {
    if (need.bead !== detail.id) return need;
    const titled = need.title === bead.title ? { ...need, title: detail.title } : need;
    if (need.kind !== 'hands') return titled;
    return { ...titled, steps: need.steps.map((step) => (ran.has(step.id) ? { ...step, ran: ran.get(step.id) } : step)) };
  });
  return { ...view, beads, needs };
}

/** A bead's fetched detail brought up to the view's copy of it: the view is applied event
 * by event (§22), so when its copy was stamped later than the detail's, its status and
 * times are the newer. Without a newer view copy the detail is returned as it is. */
export function detailAsOf(detail: BeadDetail | undefined, bead: ViewBead | undefined): BeadDetail | undefined {
  if (!detail || !bead || bead.id !== detail.id) return detail;
  const seen = Date.parse(detail.updated);
  const heard = Date.parse(bead.updated);
  if (Number.isNaN(heard) || !(Number.isNaN(seen) || heard > seen)) return detail;
  return { ...detail, status: bead.status, updated: bead.updated, started: bead.started, closed: bead.closed };
}
