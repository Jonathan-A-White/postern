// src/model/needs.ts — which needs still wait on the Governor (plans/0021
// decision 8). One he has answered or acted on since it was raised leaves the
// queue at once, before the Mayor's host has applied it and the view drops it.
import type { AnswerRow } from '../data/db';
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
