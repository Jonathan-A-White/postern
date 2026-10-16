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
});
