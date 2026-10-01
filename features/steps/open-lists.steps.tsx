// features/steps/open-lists.steps.tsx — runs features/open-lists.feature
// (mw-f758y.30): the Grillings and Open maps chips against a seeded Dexie view, no
// network. A bead's title reads "Title of <id>" unless given.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();
let beads: ViewBead[] = [];
let needs: Need[] = [];

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs, beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  needs = [];
  await Promise.all([db.settings.clear(), db.view.clear()]);
  window.history.replaceState(null, '', '/?v=map');
}

const closedAt = () => new Date(now).toISOString();
const QUESTION = 'Which bank should hold the sats?';

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/open-lists.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const twoGrillings = () => {
    beads.push(
      beadIn('mw-g.1', { title: 'Grilling: where the sats live', labels: ['wayfinder:map'] }),
      beadIn('mw-g.2', { title: 'Grilling: naming', labels: ['wayfinder:map'] }),
      beadIn('mw-g.3', { title: 'Grilling: old and done', status: 'closed', closed: closedAt() }),
    );
    needs.push({
      kind: 'question',
      bead: 'mw-g.1',
      epic: 'mw-g.1',
      title: 'Grilling: where the sats live',
      since: closedAt(),
      text: `${QUESTION}\n\n- **Option A** — the first.\n- **Option B** — the second.`,
      recommended: 'Option A',
      options: ['Option A', 'Option B'],
      blocks: 0,
      steps: [],
    });
  };
  const mapOpens = async () => {
    await save();
    render(<MapScreen />);
  };
  const buttonClosed = async (_c: unknown, name: string) => {
    expect(await screen.findByRole('button', { name, expanded: false })).toBeInTheDocument();
  };
  const tap = async (_c: unknown, name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }));
  };

  Scenario('mw-f758y.30: Grillings · 2 lists the open grillings, and the one with a card opens it', ({ Given, When, Then, And }) => {
    Given('a view with two open grillings, one with a decision card, and a closed grilling', twoGrillings);
    When('the Map opens', mapOpens);
    Then('a {string} button is shown, closed', buttonClosed);
    When('the {string} button is tapped', tap);
    Then('the Open grillings list shows both grillings and not the closed one', async () => {
      const list = await screen.findByRole('region', { name: 'Open grillings' });
      expect(within(list).getByText('Grilling: where the sats live')).toBeInTheDocument();
      expect(within(list).getByText('Grilling: naming')).toBeInTheDocument();
      expect(within(list).queryByText('Grilling: old and done')).not.toBeInTheDocument();
    });
    And('the grilling with a card shows its question line', async () => {
      const list = await screen.findByRole('region', { name: 'Open grillings' });
      expect(within(list).getByRole('button', { name: QUESTION, expanded: false })).toBeInTheDocument();
      expect(within(list).queryByTestId('need-card')).not.toBeInTheDocument();
    });
    When('the question line is tapped', async () => {
      await userEvent.click(await screen.findByRole('button', { name: QUESTION }));
    });
    Then('the card opens with its answers', async () => {
      const card = await screen.findByTestId('need-card');
      await waitFor(() => expect(within(card).getByRole('button', { name: 'Option B' })).toBeInTheDocument());
    });
  });

  Scenario('mw-f758y.30: Open maps · 1 lists the open map that is not a grilling', ({ Given, When, Then }) => {
    Given('a view with an open map, an open grilling that is also a map, a finished map and a closed map', () => {
      beads.push(
        beadIn('mw-m', { title: 'The open map', type: 'epic', labels: ['wayfinder:map'] }),
        beadIn('mw-m.1', { parent: 'mw-m' }),
        beadIn('mw-gm', { title: 'Grilling: a map too', type: 'epic', labels: ['wayfinder:map'] }),
        beadIn('mw-gm.1', { parent: 'mw-gm' }),
        beadIn('mw-f', { title: 'The finished map', type: 'epic', labels: ['wayfinder:map'] }),
        beadIn('mw-f.1', { parent: 'mw-f', status: 'closed', closed: closedAt() }),
        beadIn('mw-c', { title: 'The closed map', type: 'epic', status: 'closed', closed: closedAt(), labels: ['wayfinder:map'] }),
        beadIn('mw-c.1', { parent: 'mw-c', status: 'closed', closed: closedAt() }),
      );
    });
    When('the Map opens', mapOpens);
    Then('an {string} button is shown, closed', buttonClosed);
    When('the {string} button is tapped', tap);
    Then('the Open maps list shows the open map and nothing else', async () => {
      const list = await screen.findByRole('region', { name: 'Open maps' });
      expect(within(list).getAllByTestId('epic-card')).toHaveLength(1);
      expect(within(list).getByText('The open map')).toBeInTheDocument();
    });
  });

  Scenario('mw-f758y.30: Needs you has the same two chips', ({ Given, When, Then }) => {
    Given('a view with two open grillings, one with a decision card, and a closed grilling', twoGrillings);
    When('the Needs screen opens', async () => {
      await save();
      render(<NeedsScreen />);
    });
    Then('a {string} button is shown, closed', buttonClosed);
  });
});
