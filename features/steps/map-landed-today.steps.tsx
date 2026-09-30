// features/steps/map-landed-today.steps.tsx — runs features/map-landed-today.feature
// (mw-gq6.155): the Map's factory level against a seeded Dexie view, no network.
// The tile's own href is followed, so the count and the list it opens are compared
// through the route, not through a copy of it.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { parseRoute } from '../../src/nav/route';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const HOUR = 3_600_000;
let now = Date.now();
let beads: ViewBead[] = [];

function closedBead(id: string, hoursAgo: number): ViewBead {
  const template = fixtureView(now).beads[0];
  return {
    ...template,
    id,
    title: `Title of ${id}`,
    type: 'task',
    status: 'closed',
    parent: undefined,
    labels: [],
    waits: [],
    done_earlier: 0,
    closed: new Date(now - hoursAgo * HOUR).toISOString(),
  };
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  await Promise.all([db.settings.clear(), db.view.clear()]);
  window.history.replaceState(null, '', '/?v=map');
}

async function mapOpens(search = '?v=map'): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  cleanup();
  const route = parseRoute(search);
  if (route.view !== 'map') throw new Error('not a map route');
  render(<MapScreen key={`${route.bucket ?? ''}|${route.landed ?? ''}`} bucket={route.bucket} landed={route.landed} />);
}

const title = (id: string) => `Title of ${id}`;
const tile = () => screen.findByRole('link', { name: /^Landed today/ });

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/map-landed-today.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const threeBeads = () => {
    beads.push(closedBead('mw-x.recent', 2), closedBead('mw-x.old', 30), closedBead('mw-x.week', 6 * 24));
  };

  Scenario('mw-gq6.155: Landed today opens only what closed in the last 24 hours', ({ Given, When, Then }) => {
    Given('beads closed 2 hours, 30 hours and 6 days ago', threeBeads);
    When('the Map opens', () => mapOpens());
    Then('the Landed today tile counts 1', async () => {
      expect(within(await tile()).getByText('1')).toBeInTheDocument();
    });
    When('the Landed today tile is tapped', async () => {
      const href = (await tile()).getAttribute('href') as string;
      await mapOpens(href);
    });
    Then('the list is headed {string} and holds only the bead closed 2 hours ago', async (_c, heading: string) => {
      const section = await screen.findByRole('region', { name: 'Matching work' });
      await waitFor(() => expect(within(section).getByText(heading)).toBeInTheDocument());
      expect(within(section).getByText(title('mw-x.recent'))).toBeInTheDocument();
      expect(within(section).queryByText(title('mw-x.old'))).not.toBeInTheDocument();
      expect(within(section).queryByText(title('mw-x.week'))).not.toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.155: the Done column still lists every closed bead', ({ Given, When, Then }) => {
    Given('beads closed 2 hours, 30 hours and 6 days ago', threeBeads);
    When('the Map opens on the Done column', () => mapOpens('?v=map&b=done'));
    Then('the list holds all three beads', async () => {
      const section = await screen.findByRole('region', { name: 'Matching work' });
      await waitFor(() => expect(within(section).getByText(title('mw-x.recent'))).toBeInTheDocument());
      expect(within(section).getByText(title('mw-x.old'))).toBeInTheDocument();
      expect(within(section).getByText(title('mw-x.week'))).toBeInTheDocument();
    });
  });
});
