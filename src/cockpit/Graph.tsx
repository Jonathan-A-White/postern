// src/cockpit/Graph.tsx — an epic's work as a dependency graph (plans/0021
// decision 9): read left to right in the order work can happen, each bead
// coloured by its column on the board, each arrow "this waits on that". Scrolls
// sideways on a phone; a tap opens the bead.
import { useMemo } from 'react';
import { layoutGraph, DEFAULT_LAYOUT } from '../model/graph';
import { bucketOf, isEpic, type ViewIndex } from '../model/tree';
import type { ViewBead } from '../model/view';
import { beadHref, formatRoute } from '../nav/route';
import { navigate } from '../router';

const FILL: Record<string, string> = {
  needs: 'var(--pc-needs)',
  working: 'var(--pc-working)',
  ready: 'var(--pc-ready)',
  blocked: 'var(--pc-blocked)',
  held: 'var(--pc-held)',
  done: 'var(--pc-done)',
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function Graph({ beads, index }: { beads: ViewBead[]; index: ViewIndex }) {
  const layout = useMemo(() => layoutGraph(beads.map((bead) => ({ id: bead.id, waits: bead.waits }))), [beads]);
  const byId = useMemo(() => new Map(beads.map((bead) => [bead.id, bead])), [beads]);
  const { nodeWidth, nodeHeight } = DEFAULT_LAYOUT;

  if (beads.length === 0) return null;
  return (
    <div className="scroll-thin overflow-auto rounded-2xl border border-line bg-sunken" data-testid="graph">
      <svg width={layout.width} height={layout.height} role="img" aria-label="Dependency graph" className="block">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--pc-line-strong)" />
          </marker>
        </defs>
        {layout.edges.map((edge) => (
          <path key={`${edge.from}->${edge.to}`} d={edge.path} fill="none" stroke="var(--pc-line-strong)" strokeWidth={1.5} markerEnd="url(#arrow)" />
        ))}
        {layout.nodes.map((node) => {
          const bead = byId.get(node.id);
          if (!bead) return null;
          const bucket = bucketOf(bead, index);
          const epic = isEpic(bead, index);
          const target = epic ? formatRoute({ view: 'map', focus: bead.id, lens: 'graph' }) : beadHref(bead.id);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              role="link"
              tabIndex={0}
              aria-label={`${bead.title} (${bucket})`}
              className="cursor-pointer outline-none"
              onClick={() => navigate(target)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') navigate(target);
              }}
            >
              <rect width={nodeWidth} height={nodeHeight} rx={12} fill="var(--pc-surface)" stroke="var(--pc-line)" />
              <rect width={4} height={nodeHeight - 16} x={0} y={8} rx={2} fill={FILL[bucket]} />
              <text x={14} y={24} fontSize={12.5} fontWeight={600} fill="var(--pc-fg)">
                {clip(bead.title, 27)}
              </text>
              <text x={14} y={44} fontSize={11} fill="var(--pc-faint)" fontFamily="var(--font-mono)">
                {clip(bead.id, 16)}
                {bead.path?.host ? ` · ${bead.path.host}` : ''}
                {epic ? ' · epic' : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
