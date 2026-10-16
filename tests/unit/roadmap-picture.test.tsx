// mw-njb33n.6: the Roadmap's picture: epics as nodes sized by open stories and coloured by lane (pure),
// pan and pinch-zoom arithmetic, a tap finding its node, no WebGL falling back to the lanes, and no
// animation frame running while idle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { indexView } from '../../src/model/tree';
import {
  LANE_COLOURS,
  clampView,
  fitView,
  hitTest,
  pictureModel,
  worldToScreen,
  zoomAbout,
} from '../../src/cockpit/roadmapPicture';
import { RoadmapScreen } from '../../src/cockpit/RoadmapScreen';
import { fixtureView } from '../support/cockpit-fixture';
import type { View, ViewBead } from '../../src/model/view';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const template = fixtureView().beads[0];
const bead = (id: string, extra: Partial<ViewBead>): ViewBead => ({
  ...template,
  id,
  type: 'task',
  status: 'open',
  priority: 2,
  parent: undefined,
  labels: [],
  waits: [],
  done_earlier: 0,
  closed: '',
  ...extra,
});
const on = (rig: string) => ({ path: { rig, branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' } });

const BEADS: ViewBead[] = [
  bead('e.1', { title: 'Big epic', type: 'epic', ...on('lampas') }),
  bead('e.1.1', { title: 'a', parent: 'e.1', priority: 0, ...on('lampas') }),
  bead('e.1.2', { title: 'b', parent: 'e.1', priority: 2, ...on('lampas') }),
  bead('e.1.3', { title: 'c', parent: 'e.1', priority: 3, ...on('lampas') }),
  bead('e.1.4', { title: 'closed', parent: 'e.1', priority: 0, status: 'closed', closed: '2026-10-01T00:00:00Z', ...on('lampas') }),
  bead('e.2', { title: 'Small epic', type: 'epic', ...on('lampas') }),
  bead('e.2.1', { title: 'd', parent: 'e.2', priority: 3, ...on('lampas') }),
  bead('e.3', { title: 'Iced epic', type: 'epic', ...on('postern') }),
  bead('e.3.1', { title: 'e', parent: 'e.3', priority: 1, labels: ['icebox'], status: 'deferred', ...on('postern') }),
  bead('e.4', { title: 'Finished epic', type: 'epic', ...on('postern') }),
  bead('e.4.1', { title: 'f', parent: 'e.4', status: 'closed', closed: '2026-10-01T00:00:00Z', ...on('postern') }),
];

const indexOf = (beads: ViewBead[]) => indexView({ ...fixtureView(), needs: [], beads } as View);

describe('the picture model', () => {
  const model = pictureModel(indexOf(BEADS));
  const node = (id: string) => model.nodes.find((n) => n.id === id)!;

  it('has a node per epic with open stories, none for finished epics', () => {
    expect(model.nodes.map((n) => n.id).sort()).toEqual(['e.1', 'e.2', 'e.3']);
  });

  it('sizes a node by its open stories', () => {
    expect(node('e.1').open).toBe(3);
    expect(node('e.2').open).toBe(1);
    expect(node('e.1').r).toBeGreaterThan(node('e.2').r);
  });

  it('colours a node by its most urgent lane; iced work is Icebox however high its priority', () => {
    expect(node('e.1').lane).toBe('now');
    expect(node('e.1').colour).toEqual(LANE_COLOURS.now);
    expect(node('e.2').lane).toBe('later');
    expect(node('e.2').colour).toEqual(LANE_COLOURS.later);
    expect(node('e.3').lane).toBe('icebox');
    expect(node('e.3').colour).toEqual(LANE_COLOURS.icebox);
  });

  it('groups nodes into a cluster per app and keeps nodes apart', () => {
    expect(model.clusters.map((c) => c.app).sort()).toEqual(['lampas', 'postern']);
    for (const a of model.nodes) {
      for (const b of model.nodes) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it('is the same picture every time', () => {
    expect(pictureModel(indexOf(BEADS))).toEqual(model);
  });
});

describe('the picture view', () => {
  const model = pictureModel(indexOf(BEADS));
  const size = { width: 390, height: 520 };

  it('fits every node on screen to begin with', () => {
    const view = fitView(model, size);
    for (const n of model.nodes) {
      const p = worldToScreen(view, n);
      expect(p.x - n.r * view.scale).toBeGreaterThanOrEqual(0);
      expect(p.x + n.r * view.scale).toBeLessThanOrEqual(size.width);
      expect(p.y - n.r * view.scale).toBeGreaterThanOrEqual(0);
      expect(p.y + n.r * view.scale).toBeLessThanOrEqual(size.height);
    }
  });

  it('zooms about the finger and never past the limits', () => {
    const view = fitView(model, size);
    const at = { x: 100, y: 200 };
    const before = { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
    const zoomed = zoomAbout(view, 2, at, model, size);
    expect(zoomed.scale).toBeCloseTo(view.scale * 2);
    expect((at.x - zoomed.x) / zoomed.scale).toBeCloseTo(before.x);
    expect((at.y - zoomed.y) / zoomed.scale).toBeCloseTo(before.y);
    expect(zoomAbout(view, 0.01, at, model, size).scale).toBeCloseTo(view.scale);
    expect(zoomAbout(view, 1000, at, model, size).scale).toBeLessThan(view.scale * 20);
  });

  it('keeps the picture from being dragged out of sight', () => {
    const view = fitView(model, size);
    const gone = clampView({ ...view, x: view.x + 100000, y: view.y - 100000 }, model, size);
    expect(gone.x).toBeLessThan(size.width);
    expect(gone.y).toBeGreaterThan(0);
  });

  it('finds the node under a point, and none in the gaps', () => {
    const view = fitView(model, size);
    const target = model.nodes.find((n) => n.id === 'e.1')!;
    const p = worldToScreen(view, target);
    expect(hitTest(model, view, p)?.id).toBe('e.1');
    expect(hitTest(model, view, { x: -50, y: -50 })).toBeUndefined();
  });
});

function fakeGl() {
  const calls: string[] = [];
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return 1;
        if (key === 'getExtension') return () => null;
        if (key === 'isContextLost') return () => false;
        return () => {
          calls.push(key);
          return {};
        };
      },
    },
  );
  return { gl, calls };
}

vi.mock('../../src/cockpit/hooks', async (orig) => {
  const real = await orig<typeof import('../../src/cockpit/hooks')>();
  return { ...real, useViewIndex: () => ({ index: indexOf(BEADS) }) };
});

describe('the Roadmap screen with the picture', () => {
  it('shows the lanes by default and a Picture toggle', () => {
    render(<RoadmapScreen />);
    expect(screen.getByTestId('roadmap')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Picture' })).toHaveAttribute('aria-selected', 'false');
  });

  it('without WebGL the lanes show, nothing throws, and the Picture says it cannot', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<RoadmapScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    expect(screen.getByTestId('roadmap')).toBeInTheDocument();
    expect(screen.queryByTestId('roadmap-picture')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/WebGL/);
  });

  it('draws once on opening and runs no animation frame while idle', async () => {
    const { gl, calls } = fakeGl();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as unknown as RenderingContext);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<RoadmapScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    expect(screen.getByTestId('roadmap-picture')).toBeInTheDocument();
    expect(calls.filter((c) => c === 'drawArrays').length).toBeGreaterThan(0);
    const drawn = calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(raf).not.toHaveBeenCalled();
    expect(calls.length).toBe(drawn);
  });
});
