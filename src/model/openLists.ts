// src/model/openLists.ts — the two lists the Governor asked to find in one tap
// (mw-f758y.30): every open grilling with the card it is waiting on, and every
// open wayfinder map that is not itself a grilling.
import { isClosed, isFinished, isMap, type ViewIndex } from './tree';
import type { Need, ViewBead } from './view';

const GRILLING_TITLE = /^\s*grilling:/i;

export function isGrilling(bead: ViewBead): boolean {
  return GRILLING_TITLE.test(bead.title);
}

export interface OpenGrilling {
  bead: ViewBead;
  /** The card waiting on this grilling, if any (the first one the view lists). */
  need?: Need;
}

/** Every open bead titled 'Grilling:', the one with a waiting card first. */
export function openGrillings(index: ViewIndex): OpenGrilling[] {
  const found = index.view.beads
    .filter((bead) => isGrilling(bead) && !isClosed(bead))
    .map((bead) => ({ bead, need: index.needsByBead.get(bead.id)?.[0] }));
  const waiting = (entry: OpenGrilling) => (entry.need ? 0 : 1);
  return found.map((entry, at) => ({ entry, at })).sort((a, b) => waiting(a.entry) - waiting(b.entry) || a.at - b.at).map(({ entry }) => entry);
}

/** Every open wayfinder map that is not a grilling and not folded into Done. */
export function openMaps(index: ViewIndex): ViewBead[] {
  return index.view.beads.filter((bead) => isMap(bead) && !isGrilling(bead) && !isClosed(bead) && !isFinished(bead, index));
}

/** A card's first line as the words to show on a list row: Markdown marks off. */
export function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.replace(/^[\s#>]+/, '').replace(/\*\*|__/g, '').trim();
}
