// src/model/graph.ts — lays out an epic's dependency graph (plans/0021
// decision 9: a graph on wide screens) as layers, left to right: a bead sits one
// column right of the latest thing it waits on, so reading across is reading the
// order work can happen in. Rows within a column follow the average row of what
// each bead waits on, which keeps most edges short and uncrossed.

export interface GraphNodeInput {
  id: string;
  waits: string[];
}

export interface LaidOutNode {
  id: string;
  layer: number;
  row: number;
  x: number;
  y: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  path: string;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  padding: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { nodeWidth: 208, nodeHeight: 64, columnGap: 56, rowGap: 14, padding: 16 };

export function layoutGraph(inputs: GraphNodeInput[], options: LayoutOptions = DEFAULT_LAYOUT): GraphLayout {
  const ids = new Set(inputs.map((node) => node.id));
  const waitsOf = new Map(inputs.map((node) => [node.id, node.waits.filter((id) => ids.has(id) && id !== node.id)]));

  // Longest path from a source, with a guard against cycles: a bead met again
  // while its own layer is still being worked out is treated as a source.
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const waits = waitsOf.get(id) ?? [];
    const value = waits.length === 0 ? 0 : Math.max(...waits.map(layerOf)) + 1;
    visiting.delete(id);
    layer.set(id, value);
    return value;
  };
  for (const node of inputs) layerOf(node.id);

  const columns: string[][] = [];
  for (const node of inputs) {
    const l = layer.get(node.id) ?? 0;
    (columns[l] ??= []).push(node.id);
  }

  const row = new Map<string, number>();
  columns.forEach((column, l) => {
    if (l === 0) {
      column.forEach((id, index) => row.set(id, index));
      return;
    }
    const scored = column.map((id, index) => {
      const waits = waitsOf.get(id) ?? [];
      const rows = waits.map((w) => row.get(w)).filter((r): r is number => r !== undefined);
      const barycenter = rows.length ? rows.reduce((sum, r) => sum + r, 0) / rows.length : index;
      return { id, barycenter, index };
    });
    scored.sort((a, b) => a.barycenter - b.barycenter || a.index - b.index);
    scored.forEach((entry, index) => row.set(entry.id, index));
    column.splice(0, column.length, ...scored.map((entry) => entry.id));
  });

  const { nodeWidth, nodeHeight, columnGap, rowGap, padding } = options;
  const tallest = Math.max(1, ...columns.map((column) => column?.length ?? 0));
  const nodes: LaidOutNode[] = [];
  const position = new Map<string, LaidOutNode>();
  columns.forEach((column, l) => {
    (column ?? []).forEach((id) => {
      const r = row.get(id) ?? 0;
      const node = {
        id,
        layer: l,
        row: r,
        x: padding + l * (nodeWidth + columnGap),
        y: padding + r * (nodeHeight + rowGap),
      };
      nodes.push(node);
      position.set(id, node);
    });
  });

  const edges: LaidOutEdge[] = [];
  for (const node of inputs) {
    const to = position.get(node.id);
    if (!to) continue;
    for (const blocker of waitsOf.get(node.id) ?? []) {
      const from = position.get(blocker);
      if (!from) continue;
      const x1 = from.x + nodeWidth;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + nodeHeight / 2;
      const bend = Math.max(24, (x2 - x1) / 2);
      edges.push({ from: blocker, to: node.id, path: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}` });
    }
  }

  return {
    nodes,
    edges,
    width: padding * 2 + Math.max(1, columns.length) * nodeWidth + Math.max(0, columns.length - 1) * columnGap,
    height: padding * 2 + tallest * nodeHeight + (tallest - 1) * rowGap,
  };
}
