// src/cockpit/roadmapPicture.ts — the Roadmap's picture (mw-njb33n.6): every app a cluster, every epic a node
// sized by its open stories and coloured by the lane of its most urgent one. Pure: a live view in, circles
// out, and the arithmetic of pan, pinch-zoom and a tap finding its node, so a test can state each without a
// screen. The drawing is RoadmapPicture.tsx's.
import { LANES, OTHER_APP, laneOf, type LaneId } from '../model/roadmap';
import { isClosed, isEpic, rigOf, type ViewIndex } from '../model/tree';

export type Rgb = readonly [number, number, number];

/** A lane's colour, 0-1 per channel: the legend and the picture draw from this one table. */
export const LANE_COLOURS: Record<LaneId, Rgb> = {
  now: [0.94, 0.54, 0.45],
  next: [0.94, 0.75, 0.35],
  later: [0.44, 0.71, 0.92],
  icebox: [0.64, 0.68, 0.73],
};

export const css = (colour: Rgb): string => `rgb(${colour.map((c) => Math.round(c * 255)).join(' ')})`;

export interface PictureNode {
  id: string;
  title: string;
  app: string;
  /** Open stories directly under the epic. */
  open: number;
  lane: LaneId;
  colour: Rgb;
  x: number;
  y: number;
  r: number;
}

export interface PictureCluster {
  app: string;
  x: number;
  y: number;
  r: number;
  open: number;
}

export interface PictureModel {
  clusters: PictureCluster[];
  nodes: PictureNode[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const TODO_LABEL = 'hitl:todo';
/** A node's radius in world units: its area follows its open work. */
const NODE_UNIT = 14;
const NODE_GAP = 6;
const CLUSTER_GAP = 12;
const CLUSTER_PAD = 14;

const laneRank = (lane: LaneId) => LANES.findIndex((l) => l.id === lane);

interface Circle {
  r: number;
}

/** Greedy circle packing on an outward spiral: the biggest first, each at the nearest free place. Deterministic. */
function pack(circles: Circle[], gap: number): { x: number; y: number }[] {
  const order = circles.map((_, i) => i).sort((a, b) => circles[b].r - circles[a].r || a - b);
  const placed: { x: number; y: number; r: number }[] = [];
  const out: { x: number; y: number }[] = new Array(circles.length);
  for (const i of order) {
    const r = circles[i].r;
    let at = { x: 0, y: 0 };
    if (placed.length > 0) {
      for (let k = 1; ; k++) {
        const angle = k * 0.45;
        const rho = k * 1.2;
        at = { x: rho * Math.cos(angle), y: rho * Math.sin(angle) };
        if (placed.every((p) => Math.hypot(p.x - at.x, p.y - at.y) >= p.r + r + gap)) break;
      }
    }
    placed.push({ ...at, r });
    out[i] = at;
  }
  return out;
}

/** The epics of a view with open work in them, by app. Closed epics, to-do cards and stories with no epic are not drawn. */
export function pictureModel(index: ViewIndex): PictureModel {
  const byApp = new Map<string, PictureNode[]>();
  for (const epic of index.view.beads) {
    if (isClosed(epic) || !isEpic(epic, index) || epic.labels.includes(TODO_LABEL)) continue;
    const open = (index.children.get(epic.id) ?? []).filter(
      (child) => !isClosed(child) && !isEpic(child, index) && !child.labels.includes(TODO_LABEL),
    );
    if (open.length === 0) continue;
    const lane = open.map((child) => laneOf(child)).sort((a, b) => laneRank(a) - laneRank(b))[0];
    const app = rigOf(epic, index) || OTHER_APP;
    const node: PictureNode = {
      id: epic.id,
      title: epic.title,
      app,
      open: open.length,
      lane,
      colour: LANE_COLOURS[lane],
      x: 0,
      y: 0,
      r: NODE_UNIT * Math.sqrt(open.length),
    };
    byApp.set(app, [...(byApp.get(app) ?? []), node]);
  }

  // Each app's nodes packed round their own middle; then the apps packed against each other.
  const apps = [...byApp.entries()]
    .map(([app, nodes]) => {
      const spots = pack(nodes, NODE_GAP);
      const minX = Math.min(...nodes.map((n, i) => spots[i].x - n.r));
      const maxX = Math.max(...nodes.map((n, i) => spots[i].x + n.r));
      const minY = Math.min(...nodes.map((n, i) => spots[i].y - n.r));
      const maxY = Math.max(...nodes.map((n, i) => spots[i].y + n.r));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const r = Math.max(...nodes.map((n, i) => Math.hypot(spots[i].x - cx, spots[i].y - cy) + n.r)) + CLUSTER_PAD;
      return { app, nodes, spots: spots.map((s) => ({ x: s.x - cx, y: s.y - cy })), r, open: nodes.reduce((sum, n) => sum + n.open, 0) };
    })
    .sort((a, b) => b.open - a.open || a.app.localeCompare(b.app));
  const places = pack(apps, CLUSTER_GAP);

  const clusters: PictureCluster[] = [];
  const nodes: PictureNode[] = [];
  apps.forEach((a, i) => {
    clusters.push({ app: a.app, x: places[i].x, y: places[i].y, r: a.r, open: a.open });
    a.nodes.forEach((n, j) => nodes.push({ ...n, x: places[i].x + a.spots[j].x, y: places[i].y + a.spots[j].y }));
  });

  const bounds =
    clusters.length === 0
      ? { minX: -1, minY: -1, maxX: 1, maxY: 1 }
      : {
          minX: Math.min(...clusters.map((c) => c.x - c.r)),
          minY: Math.min(...clusters.map((c) => c.y - c.r)),
          maxX: Math.max(...clusters.map((c) => c.x + c.r)),
          maxY: Math.max(...clusters.map((c) => c.y + c.r)),
        };
  return { clusters, nodes, bounds };
}

/** Screen = world * scale + (x, y), in CSS pixels. */
export interface PictureView {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

const FIT_PAD = 16;
/** Never fitted larger than this, so a lone small epic is not blown up. */
const FIT_MAX_SCALE = 2;
/** Zoom in to this many times the fit. */
export const MAX_ZOOM = 8;

export function worldToScreen(view: PictureView, p: Point): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** Everything on screen, centred. */
export function fitView(model: PictureModel, size: Size): PictureView {
  const { minX, minY, maxX, maxY } = model.bounds;
  const scale = Math.min(
    FIT_MAX_SCALE,
    Math.max(0.01, (size.width - 2 * FIT_PAD) / (maxX - minX)),
    Math.max(0.01, (size.height - 2 * FIT_PAD) / (maxY - minY)),
  );
  return { scale, x: size.width / 2 - ((minX + maxX) / 2) * scale, y: size.height / 2 - ((minY + maxY) / 2) * scale };
}

/** The picture's middle stays on the picture: it cannot be dragged out of sight. */
export function clampView(view: PictureView, model: PictureModel, size: Size): PictureView {
  const { minX, minY, maxX, maxY } = model.bounds;
  const cx = Math.min(maxX, Math.max(minX, (size.width / 2 - view.x) / view.scale));
  const cy = Math.min(maxY, Math.max(minY, (size.height / 2 - view.y) / view.scale));
  return { scale: view.scale, x: size.width / 2 - cx * view.scale, y: size.height / 2 - cy * view.scale };
}

/** Zoom by `factor` keeping the world point under `at` where it is, within the fit and MAX_ZOOM times it. */
export function zoomAbout(view: PictureView, factor: number, at: Point, model: PictureModel, size: Size): PictureView {
  const fit = fitView(model, size).scale;
  const scale = Math.min(fit * MAX_ZOOM, Math.max(fit, view.scale * factor));
  const wx = (at.x - view.x) / view.scale;
  const wy = (at.y - view.y) / view.scale;
  return clampView({ scale, x: at.x - wx * scale, y: at.y - wy * scale }, model, size);
}

/** A finger is wider than a small dot: a node is at least this many px across to tap. */
const MIN_TAP_RADIUS = 14;

/** The node under a point (CSS px), the one the point is nearest the edge of; none in the gaps. */
export function hitTest(model: PictureModel, view: PictureView, at: Point): PictureNode | undefined {
  let best: PictureNode | undefined;
  let bestMargin = Infinity;
  for (const node of model.nodes) {
    const p = worldToScreen(view, node);
    const reach = Math.max(node.r * view.scale, MIN_TAP_RADIUS);
    const margin = Math.hypot(p.x - at.x, p.y - at.y) - reach;
    if (margin <= 0 && margin < bestMargin) {
      best = node;
      bestMargin = margin;
    }
  }
  return best;
}
