// mw-njb33n.3: the Roadmap's four lanes (Now P0-P1, Next P2, Later P3, Icebox) by app, one row per app
// with its count and top title, a tap opening the app's titles, each a link to its bead.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { indexView } from '../../src/model/tree';
import { roadmap } from '../../src/model/roadmap';
import { Roadmap } from '../../src/cockpit/RoadmapScreen';
import { parseRoute, formatRoute } from '../../src/nav/route';
import { fixtureView } from '../support/cockpit-fixture';
import type { View, ViewBead } from '../../src/model/view';

afterEach(cleanup);

const template = fixtureView().beads[0];
const story = (id: string, extra: Partial<ViewBead>): ViewBead => ({
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
  story('a.1', { title: 'Lampas: fix the lamp', priority: 0, ...on('lampas') }),
  story('a.2', { title: 'Lampas: wire the shade', priority: 1, ...on('lampas') }),
  story('a.3', { title: 'Lampas: polish the base', priority: 3, ...on('lampas') }),
  story('p.1', { title: 'Postern: the roadmap', priority: 2, ...on('postern') }),
  story('p.2', { title: 'Postern: an older P2', priority: 2, ...on('postern') }),
  story('p.3', { title: 'Postern: iced idea', priority: 4, status: 'deferred', labels: ['icebox'], ...on('postern') }),
  story('p.4', { title: 'Postern: finished work', priority: 0, status: 'closed', closed: '2026-10-01T00:00:00Z', ...on('postern') }),
  story('p.5', { title: 'Postern: an iced P1 still counts as iced', priority: 1, labels: ['icebox'], ...on('postern') }),
  story('e.1', { title: 'An epic', type: 'epic', priority: 0 }),
  story('e.1.1', { title: 'Under the epic, no path of its own', parent: 'e.1', priority: 1 }),
  story('t.1', { title: 'A to-do card', priority: 0, labels: ['hitl:todo'] }),
];

function indexOf(beads: ViewBead[]) {
  const view: View = { ...fixtureView(), needs: [], beads };
  return indexView(view);
}

describe('roadmap lanes', () => {
  const lanes = roadmap(indexOf(BEADS));
  const lane = (id: string) => lanes.find((l) => l.id === id)!;

  it('has the four lanes in order', () => {
    expect(lanes.map((l) => l.label)).toEqual(['Now', 'Next', 'Later', 'Icebox']);
  });

  it('puts P0-P1 in Now, P2 in Next, P3 in Later and anything iced in Icebox', () => {
    expect(lane('now').apps.find((a) => a.app === 'lampas')?.beads.map((b) => b.id)).toEqual(['a.1', 'a.2']);
    expect(lane('next').apps.find((a) => a.app === 'postern')?.beads.map((b) => b.id)).toEqual(['p.1', 'p.2']);
    expect(lane('later').apps.map((a) => [a.app, a.beads.length])).toEqual([['lampas', 1]]);
    expect(lane('icebox').apps.find((a) => a.app === 'postern')?.beads.map((b) => b.id)).toEqual(['p.5', 'p.3']);
  });

  it('leaves out closed beads, epics and to-do cards', () => {
    const all = lanes.flatMap((l) => l.apps.flatMap((a) => a.beads.map((b) => b.id)));
    expect(all).not.toContain('p.4');
    expect(all).not.toContain('e.1');
    expect(all).not.toContain('t.1');
  });

  it("files a story with no path under its epic's app, or Other", () => {
    const apps = lane('now').apps.map((a) => a.app);
    expect(apps).toContain('Other');
  });

  it('names the top title: the lowest priority number, then the oldest id', () => {
    expect(lane('now').apps.find((a) => a.app === 'lampas')?.top.id).toBe('a.1');
  });

  it('counts every lane', () => {
    expect(lanes.map((l) => l.count)).toEqual([3, 2, 1, 2]);
  });
});

describe('Roadmap screen body', () => {
  const draw = () => render(<Roadmap index={indexOf(BEADS)} />);

  it('draws a region per lane with its count and a closed row per app showing count and top title', () => {
    draw();
    const now = screen.getByRole('region', { name: 'Now' });
    expect(within(now).getByTestId('lane-count')).toHaveTextContent('3');
    const row = within(now).getByRole('button', { name: /^lampas, 2/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveTextContent('Lampas: fix the lamp');
    expect(screen.queryByText('Lampas: wire the shade')).toBeNull();
  });

  it('opens an app on a tap and shows every title as a link to its bead; a second tap closes it', () => {
    draw();
    const now = screen.getByRole('region', { name: 'Now' });
    const row = within(now).getByRole('button', { name: /^lampas, 2/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const link = within(now).getByRole('link', { name: /Lampas: wire the shade/ });
    expect(link.getAttribute('href')).toBe('?v=bead&id=a.2');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(within(now).queryByRole('link', { name: /Lampas: wire the shade/ })).toBeNull();
  });

  it('says so quietly when a lane is empty', () => {
    render(<Roadmap index={indexOf([story('x.1', { title: 'Only one', priority: 2, ...on('postern') })])} />);
    expect(within(screen.getByRole('region', { name: 'Now' })).getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('roadmap route', () => {
  it('round-trips as ?v=roadmap', () => {
    expect(formatRoute({ view: 'roadmap' })).toBe('?v=roadmap');
    expect(parseRoute('?v=roadmap')).toEqual({ view: 'roadmap' });
  });
});
