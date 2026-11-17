// mw-njb33n.2: the view's hosts[].up_next (docs/protocol.md §11) decoded, and FactoryPulse's
// 'Up next: N' line that opens to the titles, each a link to its bead.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { decodeView, type View } from '../../src/model/view';
import { indexView } from '../../src/model/tree';
import { FactoryPulse } from '../../src/cockpit/FactoryPulse';
import { fixtureView } from '../support/cockpit-fixture';

afterEach(cleanup);

const NOW = Date.parse('2026-09-28T12:00:00Z');
const UP_NEXT = [
  { id: 'mw-q.1', title: 'First story' },
  { id: 'mw-q.2', title: 'Second story' },
  { id: 'mw-q.3', title: 'Third story' },
];

function viewWith(upNext?: { id: string; title: string }[]): View {
  const view = fixtureView(NOW);
  if (upNext) view.hosts = view.hosts.map((host, i) => (i === 0 ? { ...host, up_next: upNext } : host));
  return view;
}

function draw(view: View) {
  return render(<FactoryPulse index={indexView(view)} now={new Date(NOW)} />);
}

describe('decodeView up_next', () => {
  it('keeps a host\'s up_next as id and title, and drops entries without an id', () => {
    const view = decodeView(
      JSON.stringify({
        v: 2,
        hosts: [
          { name: 'desktop', last_sync: 'x', up_next: [{ id: 'a.1', title: 'One' }, { title: 'no id' }, { id: 'a.2' }] },
          { name: 'laptop', last_sync: 'y' },
        ],
      }),
    );
    expect(view.hosts[0].up_next).toEqual([
      { id: 'a.1', title: 'One' },
      { id: 'a.2', title: 'a.2' },
    ]);
    expect(view.hosts[1].up_next).toBeUndefined();
  });

  it('reads an older view with no up_next as having none', () => {
    const view = decodeView(JSON.stringify({ v: 2, hosts: [{ name: 'desktop', last_sync: 'x', up_next: 'nonsense' }] }));
    expect(view.hosts[0].up_next).toBeUndefined();
  });
});

describe('FactoryPulse up next', () => {
  it('says Up next: 3 and shows the three titles on a tap, each opening its bead', () => {
    draw(viewWith(UP_NEXT));
    const toggle = screen.getByRole('button', { name: /^Up next: 3/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('First story')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const story of UP_NEXT) {
      const link = screen.getByRole('link', { name: new RegExp(story.title) });
      expect(link.getAttribute('href')).toContain(story.id);
      expect(link).toHaveTextContent(story.id);
    }
  });

  it('shows no line for a view without up_next', () => {
    draw(viewWith());
    expect(screen.queryByText(/Up next/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Up next/ })).toBeNull();
  });

  it('shows no line for an empty up_next', () => {
    draw(viewWith([]));
    expect(screen.queryByText(/Up next/)).toBeNull();
  });

  it('counts several hosts together and names the host on each title', () => {
    const view = viewWith(UP_NEXT.slice(0, 2));
    view.hosts[1] = { ...view.hosts[1], last_sync: new Date(NOW - 60_000).toISOString(), up_next: [UP_NEXT[2]] };
    draw(view);
    fireEvent.click(screen.getByRole('button', { name: /^Up next: 3/ }));
    expect(within(screen.getByRole('list', { name: 'Up next on desktop' })).getAllByRole('link')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Up next on laptop' })).getAllByRole('link')).toHaveLength(1);
  });
});

// mw-njb33n.7: a story that may run on any host is in every host's up_next; it is shown once, under 'Any host'.
const fresh = new Date(NOW - 60_000).toISOString();
const old = new Date(NOW - 3 * 3600_000).toISOString();
const AUTO = [
  { id: 'mw-a.1', title: 'Auto one' },
  { id: 'mw-a.2', title: 'Auto two' },
];
const PIN = { id: 'mw-p.1', title: 'Pinned to desktop' };

function twelveRows(): View {
  const view = fixtureView(NOW);
  view.hosts = ['cloud1', 'cloud2', 'laptop', 'desktop'].map((name) => ({
    name,
    last_sync: fresh,
    up_next: name === 'desktop' ? [...AUTO, PIN] : [...AUTO, { id: 'mw-a.3', title: 'Auto three' }],
  }));
  const bead = (id: string, title: string, host: string) => ({ ...view.beads[0], id, title, parent: undefined, path: { ...view.beads[0].path!, host } });
  view.beads = [...view.beads, bead('mw-a.1', 'Auto one', 'auto'), bead('mw-a.2', 'Auto two', 'auto'), bead('mw-a.3', 'Auto three', 'auto'), bead('mw-p.1', PIN.title, 'desktop')];
  return view;
}

describe('FactoryPulse up next: each story once (mw-njb33n.7)', () => {
  it('AC1+2: an auto story is listed once under Any host, a pinned one under its host, and the chip counts stories', () => {
    draw(twelveRows());
    const toggle = screen.getByRole('button', { name: /^Up next: 4/ });
    fireEvent.click(toggle);
    const any = within(screen.getByRole('list', { name: 'Up next on any host' }));
    expect(any.getAllByRole('link')).toHaveLength(3);
    expect(any.getByText('Any host')).toBeInTheDocument();
    const desktop = within(screen.getByRole('list', { name: 'Up next on desktop' }));
    expect(desktop.getAllByRole('link')).toHaveLength(1);
    expect(desktop.getByText(PIN.title)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Up next on cloud1' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Up next' })).getAllByRole('link')).toHaveLength(4);
  });

  it('AC1: a story with no bead in the view that every host lists is still shown once, under Any host', () => {
    const view = fixtureView(NOW);
    view.hosts = ['desktop', 'laptop'].map((name) => ({ name, last_sync: fresh, up_next: [UP_NEXT[0]] }));
    draw(view);
    fireEvent.click(screen.getByRole('button', { name: /^Up next: 1/ }));
    expect(within(screen.getByRole('region', { name: 'Up next' })).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Any host')).toBeInTheDocument();
  });

  it('AC3: a host that is not answering has no rows of its own; its pinned story says it waits for that host', () => {
    const view = twelveRows();
    view.hosts = view.hosts.map((host) => (host.name === 'desktop' ? { ...host, last_sync: old } : host));
    draw(view);
    fireEvent.click(screen.getByRole('button', { name: /^Up next: 4/ }));
    expect(screen.queryByRole('list', { name: 'Up next on desktop' })).toBeNull();
    const waiting = within(screen.getByRole('list', { name: 'Up next waiting for desktop' }));
    expect(waiting.getByText(PIN.title)).toBeInTheDocument();
    expect(waiting.getByText('waits for desktop')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Up next on any host' })).getAllByRole('link')).toHaveLength(3);
  });

  it('AC4: a story that cannot start yet shows the reason mw gives on its row; the view carries none for the rest', () => {
    const view = twelveRows();
    view.hosts = view.hosts.map((host) => ({
      ...host,
      up_next: host.up_next!.map((s) => (s.id === 'mw-a.1' ? { ...s, waiting: 'shares src/a.ts with mw-r.1' } : s)),
    }));
    draw(view);
    fireEvent.click(screen.getByRole('button', { name: /^Up next: 4/ }));
    expect(screen.getAllByText('waiting: shares src/a.ts with mw-r.1')).toHaveLength(1);
  });

  it('decodes an optional waiting reason on an up_next story', () => {
    const view = decodeView(
      JSON.stringify({ v: 2, hosts: [{ name: 'd', last_sync: 'x', up_next: [{ id: 'a', title: 'A', waiting: 'shares f with b' }, { id: 'c', title: 'C' }] }] }),
    );
    expect(view.hosts[0].up_next).toEqual([{ id: 'a', title: 'A', waiting: 'shares f with b' }, { id: 'c', title: 'C' }]);
  });
});
