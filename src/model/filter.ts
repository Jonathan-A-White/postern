// src/model/filter.ts — one filter for every place beads are listed (plans/0021
// decisions 9 and 13): the map's board and graph, the list, and search all narrow
// by the same fields, and a filter can be saved under a name and reused.
import { bucketOf, landedToday, type Bucket, type ViewIndex } from './tree';
import type { ViewBead } from './view';

export interface BeadFilter {
  text: string;
  buckets: Bucket[];
  rigs: string[];
  hosts: string[];
  types: string[];
  /** Only beads closed within the last 24 hours (the Landed today figure). */
  landedToday?: boolean;
}

export const EMPTY_FILTER: BeadFilter = { text: '', buckets: [], rigs: [], hosts: [], types: [] };

export function isEmptyFilter(filter: BeadFilter): boolean {
  return !filter.text.trim() && !filter.buckets.length && !filter.rigs.length && !filter.hosts.length && !filter.types.length && !filter.landedToday;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Every word of the query must appear somewhere in the bead's id, title,
 * summary, labels or path. */
export function matchesText(bead: ViewBead, query: string): boolean {
  const words = tokens(query);
  if (!words.length) return true;
  const haystack = [bead.id, bead.title, bead.summary, bead.labels.join(' '), bead.assignee, ...(bead.path ? Object.values(bead.path) : [])]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function matchesFilter(bead: ViewBead, index: ViewIndex, filter: BeadFilter, now: Date = new Date()): boolean {
  if (filter.landedToday && !landedToday(bead, now)) return false;
  if (filter.buckets.length && !filter.buckets.includes(bucketOf(bead, index))) return false;
  if (filter.rigs.length && !filter.rigs.includes(bead.path?.rig ?? '')) return false;
  if (filter.hosts.length && !filter.hosts.includes(bead.path?.host ?? '')) return false;
  if (filter.types.length && !filter.types.includes(bead.type)) return false;
  return matchesText(bead, filter.text);
}

/** When a bead last did anything: the latest of its updated, started and closed
 * stamps (ISO, so they compare as text). Empty when it has none. */
export function lastActivity(bead: ViewBead): string {
  return [bead.updated, bead.started, bead.closed].reduce((latest, stamp) => (stamp > latest ? stamp : latest), '');
}

/** A copy of `beads` with the most recently active first; beads with the same
 * activity keep the order they came in. */
export function newestFirst(beads: ViewBead[]): ViewBead[] {
  return beads
    .map((bead) => ({ bead, at: lastActivity(bead) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((entry) => entry.bead);
}

/** The values each facet can take in this view, for the filter chips to offer. */
export function facets(index: ViewIndex): { rigs: string[]; hosts: string[]; types: string[] } {
  const rigs = new Set<string>();
  const hosts = new Set<string>();
  const types = new Set<string>();
  for (const bead of index.view.beads) {
    if (bead.path?.rig) rigs.add(bead.path.rig);
    if (bead.path?.host) hosts.add(bead.path.host);
    if (bead.type) types.add(bead.type);
  }
  const sorted = (set: Set<string>) => [...set].sort();
  return { rigs: sorted(rigs), hosts: sorted(hosts), types: sorted(types) };
}

export interface SavedFilter {
  name: string;
  filter: BeadFilter;
}

export function describeFilter(filter: BeadFilter): string {
  const parts: string[] = [];
  if (filter.landedToday) parts.push('landed today');
  if (filter.text.trim()) parts.push(`“${filter.text.trim()}”`);
  if (filter.buckets.length) parts.push(filter.buckets.join(', '));
  if (filter.rigs.length) parts.push(filter.rigs.join(', '));
  if (filter.hosts.length) parts.push(`on ${filter.hosts.join(', ')}`);
  if (filter.types.length) parts.push(filter.types.join(', '));
  return parts.join(' · ') || 'Everything';
}
