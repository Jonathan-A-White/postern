// features/steps/roadmap.steps.tsx — runs features/roadmap.feature (mw-njb33n.3): the Roadmap's lanes by app.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Roadmap } from '../../src/cockpit/RoadmapScreen';
import { indexView } from '../../src/model/tree';
import type { ViewBead } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/roadmap.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let beads: ViewBead[];

  BeforeEachScenario(() => {
    cleanup();
    beads = [];
  });

  const template = fixtureView().beads[0];
  const story = (id: string, rig: string, priority: number, extra: Partial<ViewBead> = {}): ViewBead => ({
    ...template,
    id,
    title: `${rig} story ${id}`,
    type: 'task',
    status: 'open',
    priority,
    parent: undefined,
    labels: [],
    waits: [],
    closed: '',
    path: { rig, branch: 'main', host: 'laptop', model: 'sonnet', effort: 'high', formula: 'tdd-feature', harness: 'claude' },
    ...extra,
  });

  Scenario('mw-njb33n.3 AC1: the lanes count the work by app and a tap opens an app to its titles', ({ Given, When, Then, And }) => {
    Given('a view with open work across two apps at several priorities', () => {
      beads = [
        story('l.1', 'lampas', 0),
        story('l.2', 'lampas', 1),
        story('p.1', 'postern', 1),
        story('p.2', 'postern', 2),
        story('l.3', 'lampas', 3),
        story('p.3', 'postern', 4, { labels: ['icebox'], status: 'deferred' }),
      ];
    });
    When('the Roadmap is drawn', () => {
      render(<Roadmap index={indexView({ ...fixtureView(), needs: [], beads })} />);
    });
    Then('the Now lane counts {int} and shows one row for {string} with its top title', (_c, count: number, app: string) => {
      const now = screen.getByRole('region', { name: 'Now' });
      expect(within(now).getByTestId('lane-count')).toHaveTextContent(String(count));
      expect(within(now).getByRole('button', { name: new RegExp(`^${app}, 2`) })).toHaveTextContent('lampas story l.1');
    });
    And('the Next, Later and Icebox lanes count {int}, {int} and {int}', (_c, next: number, later: number, icebox: number) => {
      for (const [lane, n] of [['Next', next], ['Later', later], ['Icebox', icebox]] as const) {
        expect(within(screen.getByRole('region', { name: lane })).getByTestId('lane-count')).toHaveTextContent(String(n));
      }
    });
    When('he taps the {string} row in Now', (_c, app: string) => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Now' })).getByRole('button', { name: new RegExp(`^${app}, 2`) }));
    });
    Then('its titles show, each a link to its bead', () => {
      const now = screen.getByRole('region', { name: 'Now' });
      expect(within(now).getByRole('link', { name: /lampas story l\.2/ }).getAttribute('href')).toContain('l.2');
      expect(within(now).getByRole('link', { name: /lampas story l\.1/ }).getAttribute('href')).toContain('l.1');
    });
  });
});
