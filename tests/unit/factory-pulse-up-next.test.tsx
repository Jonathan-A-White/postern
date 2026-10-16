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
    view.hosts[1] = { ...view.hosts[1], up_next: [UP_NEXT[2]] };
    draw(view);
    fireEvent.click(screen.getByRole('button', { name: /^Up next: 3/ }));
    expect(within(screen.getByRole('list', { name: 'Up next on desktop' })).getAllByRole('link')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Up next on laptop' })).getAllByRole('link')).toHaveLength(1);
  });
});
