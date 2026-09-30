// features/steps/map-done.steps.tsx — runs features/map-done.feature (mw-tbx1n.13):
// the Map's factory level against a seeded Dexie view, no network. A bead's title
// reads "Title of <id>" so a card is found by its title.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();
let beads: ViewBead[] = [];

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  await Promise.all([db.settings.clear(), db.view.clear()]);
  window.history.replaceState(null, '', '/?v=map');
}

const title = (id: string) => `Title of ${id}`;
const epicsSection = () => screen.findByRole('region', { name: 'Epics' });
const doneButton = () => screen.queryByRole('button', { name: /^Done · / });

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/map-done.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const twoEpics = (_c: unknown, finished: string, live: string) => {
    beads.push(beadIn(finished, { type: 'epic' }), beadIn(`${finished}.1`, { parent: finished, status: 'closed', closed: new Date(now).toISOString() }));
    beads.push(beadIn(live, { type: 'epic' }), beadIn(`${live}.1`, { parent: live }));
  };
  const mapOpens = async () => {
    await save();
    render(<MapScreen />);
  };
  const doneClosed = async () => {
    expect(await screen.findByRole('button', { name: 'Done · 1', expanded: false })).toBeInTheDocument();
  };
  const tapDone = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Done · 1' }));
  };

  Scenario('mw-tbx1n.13: Done · 1 opens to show the finished epic', ({ Given, When, Then, And }) => {
    Given('an epic {string} whose only child is closed and an epic {string} with an open child', twoEpics);
    When('the Map opens', mapOpens);
    Then('the Epics section lists {string} and not {string}', async (_c, shown: string, hidden: string) => {
      const section = await epicsSection();
      await waitFor(() => expect(within(section).getByText(title(shown))).toBeInTheDocument());
      expect(within(section).queryByText(title(hidden))).not.toBeInTheDocument();
    });
    And('a {string} button is shown, closed', doneClosed);
    When('the {string} button is tapped', tapDone);
    Then('the Done section lists {string}', async (_c, id: string) => {
      const section = await screen.findByRole('region', { name: 'Done' });
      expect(within(section).getByText(title(id))).toBeInTheDocument();
    });
  });

  Scenario('mw-tbx1n.13: a new open child brings a finished epic back by itself', ({ Given, When, Then, And }) => {
    Given('an epic {string} whose only child is closed and an epic {string} with an open child', twoEpics);
    When('the Map opens', mapOpens);
    Then('a {string} button is shown, closed', doneClosed);
    When('a new open child is filed under {string}', async (_c, id: string) => {
      beads.push(beadIn(`${id}.2`, { parent: id }));
      await save();
    });
    Then('the Epics section lists {string} and {string}', async (_c, a: string, b: string) => {
      const section = await epicsSection();
      await waitFor(() => expect(within(section).getByText(title(a))).toBeInTheDocument());
      expect(within(section).getByText(title(b))).toBeInTheDocument();
    });
    And('no Done button is shown', async () => {
      await waitFor(() => expect(doneButton()).not.toBeInTheDocument());
    });
  });
});
