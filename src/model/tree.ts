// src/model/tree.ts — the view as a tree the cockpit can walk at any zoom
// (plans/0021 decision 9): factory → map → epic → story. Indexes the flat
// §11 bead list once, and answers what every screen asks of it: a bead's
// children and ancestors, which column of the board it belongs in, and how far
// along an epic is.
import type { Need, View, ViewBead } from './view';
import type { Tone } from '../ui';

export type Bucket = 'needs' | 'working' | 'ready' | 'blocked' | 'held' | 'done';

export const BUCKETS: { bucket: Bucket; label: string; tone: Tone }[] = [
  { bucket: 'needs', label: 'Needs you', tone: 'needs' },
  { bucket: 'working', label: 'Working', tone: 'working' },
  { bucket: 'ready', label: 'Ready', tone: 'ready' },
  { bucket: 'blocked', label: 'Blocked', tone: 'blocked' },
  { bucket: 'held', label: 'Held', tone: 'held' },
  { bucket: 'done', label: 'Done', tone: 'done' },
];

export const BUCKET_TONE: Record<Bucket, Tone> = Object.fromEntries(BUCKETS.map((b) => [b.bucket, b.tone])) as Record<Bucket, Tone>;
export const BUCKET_LABEL: Record<Bucket, string> = Object.fromEntries(BUCKETS.map((b) => [b.bucket, b.label])) as Record<Bucket, string>;

export const MAP_LABEL = 'wayfinder:map';

export interface ViewIndex {
  view: View;
  byId: Map<string, ViewBead>;
  children: Map<string, ViewBead[]>;
  roots: ViewBead[];
  needsByBead: Map<string, Need[]>;
  /** id → the ids of the beads that wait on it (the reverse of `waits`). */
  waitedOnBy: Map<string, string[]>;
}

function byPriorityThenTitle(a: ViewBead, b: ViewBead): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function indexView(view: View): ViewIndex {
  const byId = new Map<string, ViewBead>();
  for (const bead of view.beads) byId.set(bead.id, bead);

  const children = new Map<string, ViewBead[]>();
  const roots: ViewBead[] = [];
  for (const bead of view.beads) {
    if (bead.parent && byId.has(bead.parent)) {
      const siblings = children.get(bead.parent) ?? [];
      siblings.push(bead);
      children.set(bead.parent, siblings);
    } else {
      roots.push(bead);
    }
  }
  for (const list of children.values()) list.sort(byPriorityThenTitle);
  roots.sort(byPriorityThenTitle);

  const needsByBead = new Map<string, Need[]>();
  for (const need of view.needs) {
    if (!need.bead) continue;
    const list = needsByBead.get(need.bead) ?? [];
    list.push(need);
    needsByBead.set(need.bead, list);
  }

  const waitedOnBy = new Map<string, string[]>();
  for (const bead of view.beads) {
    for (const blocker of bead.waits) {
      const list = waitedOnBy.get(blocker) ?? [];
      list.push(bead.id);
      waitedOnBy.set(blocker, list);
    }
  }

  return { view, byId, children, roots, needsByBead, waitedOnBy };
}

export function isClosed(bead: ViewBead): boolean {
  return bead.status === 'closed';
}

export function isEpic(bead: ViewBead, index?: ViewIndex): boolean {
  return bead.type === 'epic' || (index?.children.get(bead.id)?.length ?? 0) > 0;
}

export function isMap(bead: ViewBead): boolean {
  return bead.labels.includes(MAP_LABEL);
}

/** Which board column a bead belongs in: anything waiting on the Governor first,
 * then what the tracker says. An open bead that still waits on unfinished work
 * is blocked; one that waits on nothing is ready. */
export function bucketOf(bead: ViewBead, index: ViewIndex): Bucket {
  if (isClosed(bead)) return index.needsByBead.get(bead.id)?.some((n) => n.kind === 'verify') ? 'needs' : 'done';
  if (index.needsByBead.has(bead.id)) return 'needs';
  if (bead.status === 'in_progress') return 'working';
  if (bead.status === 'deferred') return 'held';
  const unfinished = bead.waits.filter((id) => {
    const blocker = index.byId.get(id);
    return !blocker || !isClosed(blocker);
  });
  return unfinished.length > 0 ? 'blocked' : 'ready';
}

/** The chain of parents above a bead, root first, not including the bead. */
export function ancestors(id: string, index: ViewIndex): ViewBead[] {
  const chain: ViewBead[] = [];
  const seen = new Set<string>([id]);
  let current = index.byId.get(id);
  while (current?.parent && !seen.has(current.parent)) {
    const parent = index.byId.get(current.parent);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parent.id);
    current = parent;
  }
  return chain;
}

/** Every bead below `id`, depth first, children in board order. */
export function descendants(id: string, index: ViewIndex): ViewBead[] {
  const out: ViewBead[] = [];
  const seen = new Set<string>([id]);
  const walk = (parent: string) => {
    for (const child of index.children.get(parent) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

export interface EpicStats {
  /** Work items below the epic (child epics are containers, not counted), plus
   * the children that closed before the view's window. */
  total: number;
  done: number;
  counts: Record<Bucket, number>;
  needs: number;
  lastActivity: string;
  rigs: string[];
}

export function epicStats(epicId: string, index: ViewIndex): EpicStats {
  const counts: Record<Bucket, number> = { needs: 0, working: 0, ready: 0, blocked: 0, held: 0, done: 0 };
  const rigs = new Set<string>();
  let lastActivity = index.byId.get(epicId)?.updated ?? '';
  let doneEarlier = index.byId.get(epicId)?.done_earlier ?? 0;
  const all = descendants(epicId, index);
  for (const bead of all) {
    const latest = [bead.updated, bead.closed, bead.started].sort().at(-1) ?? '';
    if (latest > lastActivity) lastActivity = latest;
    if (bead.path?.rig) rigs.add(bead.path.rig);
    if (isEpic(bead, index)) {
      doneEarlier += bead.done_earlier;
      continue;
    }
    counts[bucketOf(bead, index)] += 1;
  }
  const epic = index.byId.get(epicId);
  if (epic?.path?.rig) rigs.add(epic.path.rig);
  const needs = index.view.needs.filter((need) => need.bead === epicId || all.some((bead) => bead.id === need.bead)).length;
  const done = counts.done + doneEarlier;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0) + doneEarlier;
  return { total, done, counts, needs, lastActivity, rigs: [...rigs].sort() };
}

/** The rig a bead is worked in: its own path's, else the first one found below it. */
export function rigOf(bead: ViewBead, index: ViewIndex): string {
  if (bead.path?.rig) return bead.path.rig;
  for (const child of descendants(bead.id, index)) {
    if (child.path?.rig) return child.path.rig;
  }
  return '';
}

export interface FactoryStats {
  working: number;
  ready: number;
  blocked: number;
  held: number;
  needs: number;
  landedToday: number;
  liveEpics: number;
}

export function factoryStats(index: ViewIndex, now: Date = new Date()): FactoryStats {
  const stats: FactoryStats = { working: 0, ready: 0, blocked: 0, held: 0, needs: index.view.needs.length, landedToday: 0, liveEpics: 0 };
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  for (const bead of index.view.beads) {
    if (isEpic(bead, index)) {
      if (!isClosed(bead)) stats.liveEpics += 1;
      continue;
    }
    const bucket = bucketOf(bead, index);
    if (bucket === 'working') stats.working += 1;
    else if (bucket === 'ready') stats.ready += 1;
    else if (bucket === 'blocked') stats.blocked += 1;
    else if (bucket === 'held') stats.held += 1;
    if (isClosed(bead) && bead.closed >= dayAgo) stats.landedToday += 1;
  }
  return stats;
}

/** The top of the map: maps first, then every other root that holds work, most
 * in need of the Governor first. */
export function topLevel(index: ViewIndex): ViewBead[] {
  const tops = index.roots.filter((bead) => isEpic(bead, index) || !isClosed(bead));
  const weight = (bead: ViewBead) => (isMap(bead) ? 0 : 1);
  const needs = new Map(tops.map((bead) => [bead.id, epicStats(bead.id, index).needs]));
  return [...tops].sort((a, b) => {
    const byMap = weight(a) - weight(b);
    if (byMap !== 0) return byMap;
    const byNeeds = (needs.get(b.id) ?? 0) - (needs.get(a.id) ?? 0);
    if (byNeeds !== 0) return byNeeds;
    return byPriorityThenTitle(a, b);
  });
}
