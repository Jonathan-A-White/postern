// src/model/roadmap.ts — the Roadmap's four calm lanes (mw-njb33n.3): Now (P0-P1), Next (P2), Later (P3) and
// Icebox (anything iced), each grouped by the app (rig) the work is in. Pure: the live view in, lanes out.
import { ancestors, isClosed, isEpic, isIced, rigOf, type ViewIndex } from './tree';
import type { ViewBead } from './view';

export type LaneId = 'now' | 'next' | 'later' | 'icebox';

export const LANES: { id: LaneId; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'next', label: 'Next' },
  { id: 'later', label: 'Later' },
  { id: 'icebox', label: 'Icebox' },
];

/** The app a story with no path of its own is filed under. */
export const OTHER_APP = 'Other';

export interface RoadmapApp {
  app: string;
  /** Top first: the lowest priority number, then the oldest id. */
  beads: ViewBead[];
  top: ViewBead;
}

export interface RoadmapLane {
  id: LaneId;
  label: string;
  count: number;
  apps: RoadmapApp[];
}

const TODO_LABEL = 'hitl:todo';

export function laneOf(bead: ViewBead): LaneId {
  if (isIced(bead)) return 'icebox';
  if (bead.priority <= 1) return 'now';
  if (bead.priority === 2) return 'next';
  return 'later';
}

/** The rig a story is worked in: its own path's, else the nearest epic above it that has one. */
function appOf(bead: ViewBead, index: ViewIndex): string {
  if (bead.path?.rig) return bead.path.rig;
  for (const epic of ancestors(bead.id, index).reverse()) {
    const rig = rigOf(epic, index);
    if (rig) return rig;
  }
  return OTHER_APP;
}

const byPriorityThenId = (a: ViewBead, b: ViewBead) => a.priority - b.priority || a.id.localeCompare(b.id, undefined, { numeric: true });

/** The open stories of the view, in lanes by priority and apps within each. Closed beads, epics and to-do cards are not work on the roadmap. */
export function roadmap(index: ViewIndex): RoadmapLane[] {
  const grouped = new Map<LaneId, Map<string, ViewBead[]>>(LANES.map((lane) => [lane.id, new Map()]));
  for (const bead of index.view.beads) {
    if (isClosed(bead) || isEpic(bead, index) || bead.labels.includes(TODO_LABEL)) continue;
    const apps = grouped.get(laneOf(bead))!;
    const app = appOf(bead, index);
    apps.set(app, [...(apps.get(app) ?? []), bead]);
  }
  return LANES.map(({ id, label }) => {
    const apps: RoadmapApp[] = [...grouped.get(id)!]
      .map(([app, beads]) => {
        const sorted = [...beads].sort(byPriorityThenId);
        return { app, beads: sorted, top: sorted[0] };
      })
      .sort((a, b) => byPriorityThenId(a.top, b.top) || b.beads.length - a.beads.length || a.app.localeCompare(b.app));
    return { id, label, count: apps.reduce((sum, a) => sum + a.beads.length, 0), apps };
  });
}
