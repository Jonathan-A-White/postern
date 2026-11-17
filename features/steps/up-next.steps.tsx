// features/steps/up-next.steps.tsx — runs features/up-next.feature (mw-njb33n.2): the pulse's
// 'Up next: N' line from the view's hosts[].up_next (docs/protocol.md §11).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { FactoryPulse } from '../../src/cockpit/FactoryPulse';
import { indexView } from '../../src/model/tree';
import type { View } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const STORIES = [
  { id: 'mw-q.1', title: 'First story' },
  { id: 'mw-q.2', title: 'Second story' },
  { id: 'mw-q.3', title: 'Third story' },
];

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/up-next.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let view: View;

  BeforeEachScenario(() => {
    cleanup();
    view = fixtureView(NOW);
  });

  const drawn = () => {
    render(<FactoryPulse index={indexView(view)} now={new Date(NOW)} />);
  };

  Scenario('mw-njb33n.2 AC1: a view with up_next shows Up next: 3 and the three titles open on a tap, each opening its bead', ({ Given, When, Then }) => {
    Given('a view whose host lists three stories in up_next', () => {
      view.hosts = view.hosts.map((host, i) => (i === 0 ? { ...host, up_next: STORIES } : host));
    });
    When('the pulse is drawn', drawn);
    Then('it says {string} and shows no titles yet', (_c, said: string) => {
      expect(screen.getByRole('button', { name: said })).toHaveAttribute('aria-expanded', 'false');
      for (const story of STORIES) expect(screen.queryByText(story.title)).toBeNull();
    });
    When('he taps {string}', (_c, label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    Then('the three titles show, each a link to its bead', () => {
      const list = screen.getByRole('region', { name: 'Up next' });
      for (const story of STORIES) {
        const link = within(list).getByRole('link', { name: new RegExp(story.title) });
        expect(link.getAttribute('href')).toContain(story.id);
      }
    });
  });

  Scenario('mw-njb33n.2 AC1: a view without up_next shows no Up next line', ({ Given, When, Then }) => {
    Given('a view whose hosts list no up_next', () => {
      view.hosts = view.hosts.map(({ name, last_sync }) => ({ name, last_sync }));
    });
    When('the pulse is drawn', drawn);
    Then('there is no Up next line', () => {
      expect(screen.queryByText(/Up next/)).toBeNull();
    });
  });

  // mw-njb33n.7: each story once, auto stories under 'Any host', a silent host's pinned story waits for it.
  const FRESH = new Date(NOW - 60_000).toISOString();
  const OLD = new Date(NOW - 3 * 3600_000).toISOString();
  const AUTO = [
    { id: 'mw-a.1', title: 'Auto one' },
    { id: 'mw-a.2', title: 'Auto two' },
  ];
  const PIN = { id: 'mw-p.1', title: 'Pinned to desktop' };
  const withBeads = (v: View, rows: { id: string; title: string; host: string }[]) => {
    const proto = v.beads[0];
    v.beads = [...v.beads, ...rows.map((r) => ({ ...proto, id: r.id, title: r.title, parent: undefined, path: { ...proto.path!, host: r.host } }))];
  };

  Scenario('mw-njb33n.7 AC1+2: a story that may run on any host is shown once, and the chip counts stories not rows', ({ Given, When, Then }) => {
    Given('a view where four hosts list the same two auto stories and one pinned story', () => {
      view.hosts = ['cloud1', 'cloud2', 'laptop', 'desktop'].map((name) => ({ name, last_sync: FRESH, up_next: name === 'desktop' ? [...AUTO, PIN] : AUTO }));
      withBeads(view, [...AUTO.map((a) => ({ ...a, host: 'auto' })), { ...PIN, host: 'desktop' }]);
    });
    When('the pulse is drawn', drawn);
    Then('it says {string} and shows no titles yet', (_c, said: string) => {
      expect(screen.getByRole('button', { name: said })).toHaveAttribute('aria-expanded', 'false');
    });
    When('he taps {string}', (_c, label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    Then('each story shows once, the auto ones under {string}', (_c, heading: string) => {
      expect(within(screen.getByRole('region', { name: 'Up next' })).getAllByRole('link')).toHaveLength(3);
      const any = within(screen.getByRole('list', { name: 'Up next on any host' }));
      expect(any.getByText(heading)).toBeInTheDocument();
      expect(any.getAllByRole('link')).toHaveLength(2);
      expect(within(screen.getByRole('list', { name: 'Up next on desktop' })).getAllByRole('link')).toHaveLength(1);
    });
  });

  Scenario('mw-njb33n.7 AC3: a host that is not answering has no rows of its own and its pinned story waits for it', ({ Given, When, And, Then }) => {
    Given('a view where the desktop has not answered for hours and holds a pinned story', () => {
      view.hosts = [
        { name: 'desktop', last_sync: OLD, up_next: [...AUTO, PIN] },
        { name: 'laptop', last_sync: FRESH, up_next: AUTO },
      ];
      withBeads(view, [...AUTO.map((a) => ({ ...a, host: 'auto' })), { ...PIN, host: 'desktop' }]);
    });
    When('the pulse is drawn', drawn);
    And('he taps {string}', (_c, label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    Then('the pinned story says {string} and no list is headed for the desktop\'s own rows', (_c, words: string) => {
      expect(screen.getByText(words)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Up next on desktop' })).toBeNull();
      expect(within(screen.getByRole('region', { name: 'Up next' })).getAllByRole('link')).toHaveLength(3);
    });
  });

  Scenario('mw-njb33n.7 AC4: a story that cannot start yet shows the reason mw gives', ({ Given, When, And, Then }) => {
    Given('a view whose up_next story says it is waiting: shares a file with a running story', () => {
      view.hosts = [{ name: 'desktop', last_sync: FRESH, up_next: [{ ...AUTO[0], waiting: 'shares src/a.ts with mw-r.1' }] }];
    });
    When('the pulse is drawn', drawn);
    And('he taps {string}', (_c, label: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    Then("the story's row carries the reason", () => {
      expect(screen.getByText('waiting: shares src/a.ts with mw-r.1')).toBeInTheDocument();
    });
  });
});
