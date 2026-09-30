// src/model/needs.ts — which needs still wait on the Governor (plans/0021
// decision 8). One he has answered or acted on since it was raised leaves the
// queue at once, before the Mayor's host has applied it and the view drops it.
import type { AnswerRow } from '../data/db';
import { isEpic, type ViewIndex } from './tree';
import type { Need, WaitsFor } from './view';

export function unsettledNeeds(needs: Need[], answers: AnswerRow[]): Need[] {
  const answered = new Map(answers.map((row) => [row.bead, row.ts * 1000]));
  return needs.filter((need) => {
    const at = answered.get(need.bead);
    if (at === undefined || !need.bead) return true;
    const since = Date.parse(need.since);
    return !Number.isNaN(since) && since > at;
  });
}

/** Whose turn a card is: what the view says, else the factory's when it is not ready, else his. */
export function waitsFor(need: Need): WaitsFor {
  return need.waits_for ?? (need.not_ready ? 'factory' : 'you');
}

/** The unsettled needs split by whose turn they are. */
export function needsByWaiter(needs: Need[]): Record<WaitsFor, Need[]> {
  const split: Record<WaitsFor, Need[]> = { you: [], mayor: [], factory: [] };
  for (const need of needs) split[waitsFor(need)].push(need);
  return split;
}

/** A stale need (docs/protocol.md §11) always offers Keep then Close. */
export const STALE_OPTIONS = ['Keep', 'Close'];

/** The recommended answer first, then the rest in the Mayor's order. */
export function orderedOptions(need: Need): string[] {
  const options = need.kind === 'hands' ? ['Done'] : need.kind === 'demo' ? ['Looks good'] : need.kind === 'stale' ? [...STALE_OPTIONS] : [...need.options];
  if (!need.recommended || !options.includes(need.recommended)) return options;
  return [need.recommended, ...options.filter((option) => option !== need.recommended)];
}

/** One thing a card waits on: its title, and the bead's page when the view knows which bead it is. */
export interface WaitsOn {
  title: string;
  href?: string;
}

/** What a not_ready card waits on (§11's `waiting_on` titles), each linked to the open blocker of that title. */
export function waitsOnLinks(need: Need, index: ViewIndex | undefined, hrefOf: (id: string) => string): WaitsOn[] {
  const blockers = (index?.byId.get(need.bead)?.waits ?? []).map((id) => index?.byId.get(id)).filter((bead) => bead !== undefined);
  return (need.waiting_on ?? []).map((title) => {
    const blocker = blockers.find((bead) => bead.title === title);
    return blocker ? { title, href: hrefOf(blocker.id) } : { title };
  });
}

/** Whether any story under this bead is held (deferred), at any depth. */
function holdsStories(id: string, index: ViewIndex, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return (index.children.get(id) ?? []).some((child) => child.status === 'deferred' || holdsStories(child.id, index, seen));
}

/**
 * Whether a release card still has something to release, or what it already is: 'held' (or
 * 'unknown', which offers Release as before), 'building', or 'released'. A story is held when it is
 * deferred; an epic (protocol §11: the approve need's bead) when a story under it is. `status` is the
 * bead page's own fresher status, used for a story when given, else the view's.
 */
export function releaseState(need: Need, index?: ViewIndex, status?: string): 'held' | 'building' | 'released' | 'unknown' {
  const bead = index?.byId.get(need.bead);
  if (bead && index && isEpic(bead, index)) return holdsStories(bead.id, index) ? 'held' : 'released';
  const now = status ?? bead?.status ?? '';
  if (now === '') return 'unknown';
  if (now === 'deferred') return 'held';
  return now === 'in_progress' ? 'building' : 'released';
}
