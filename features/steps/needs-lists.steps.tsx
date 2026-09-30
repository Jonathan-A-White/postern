// features/steps/needs-lists.steps.tsx — runs features/needs-lists.feature (mw-tbx1n.8):
// the Needs screen against a seeded Dexie view, no network. The switch's part is
// kept in the address (?v=needs&who=mayor), so a step re-renders from useRoute.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { Shell } from '../../src/cockpit/Shell';
import { useRoute } from '../../src/router';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();

function need(extra: Partial<Need>): Need {
  return { kind: 'hands', bead: '', epic: '', title: '', since: new Date(now - 3_600_000).toISOString(), text: '', recommended: '', options: [], blocks: 0, steps: [], ...extra };
}

async function save(): Promise<void> {
  const needs = [
    need({ kind: 'question', bead: 'mw-q', title: 'Which library?', options: ['A', 'B'] }),
    need({ kind: 'hands', bead: 'mw-m', title: 'Merge the branch', waits_for: 'mayor' }),
    need({ kind: 'demo', bead: 'mw-f', title: 'Show the runner', not_ready: true, waiting_on: ['Build the runner'] }),
  ];
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs, beads: [] }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

// eslint-disable-next-line react-refresh/only-export-components
function Screen() {
  const route = useRoute();
  return <NeedsScreen who={route.view === 'needs' ? route.who : undefined} />;
}

const card = (title: string) => screen.findByRole('article', { name: new RegExp(`: ${title}$`) });

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/needs-lists.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const seeded = async () => {
    await save();
  };
  const tap = async (_c: unknown, name: string) => {
    await userEvent.click(await screen.findByRole('tab', { name }));
  };
  const opens = async () => {
    render(<Screen />);
  };

  Scenario('mw-tbx1n.8: a card waiting on the Mayor is under Mayor, not You, and has no Done', ({ Given, When, Then, And }) => {
    Given('a view with a question for him, a step waiting on the Mayor and a step waiting on the factory', seeded);
    When('the Needs screen opens', opens);
    Then('the switch reads {string}, {string} and {string}', async (_c, you: string, mayor: string, factory: string) => {
      const tabs = await screen.findByRole('tablist', { name: 'Who the cards wait on' });
      await waitFor(() => expect(within(tabs).getByRole('tab', { name: you })).toBeInTheDocument());
      expect(within(tabs).getByRole('tab', { name: mayor })).toBeInTheDocument();
      expect(within(tabs).getByRole('tab', { name: factory })).toBeInTheDocument();
    });
    And('the You list shows the question and neither step', async () => {
      await card('Which library\\?');
      expect(screen.queryByText('Merge the branch')).not.toBeInTheDocument();
      expect(screen.queryByText('Show the runner')).not.toBeInTheDocument();
    });
    When('{string} is tapped', tap);
    When('the switch is moved on to {string}', tap);
    Then("the address names the Mayor's list", async () => {
      await waitFor(() => expect(window.location.search).toContain('who=mayor'));
    });
    And('the Mayor card says {string}, has no Done button, and keeps Reply and Open', async (_c, chip: string) => {
      const mayor = await card('Merge the branch');
      expect(within(mayor).getByText(chip)).toBeInTheDocument();
      expect(within(mayor).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
      expect(within(mayor).getByRole('button', { name: 'Reply' })).toBeInTheDocument();
      expect(within(mayor).getByRole('link', { name: 'Open' })).toBeInTheDocument();
      expect(screen.queryByText('Which library?')).not.toBeInTheDocument();
    });
    Then('the Factory card says {string}, names {string}, and has no Done button', async (_c, chip: string, reason: string) => {
      const factory = await card('Show the runner');
      expect(within(factory).getByText(chip)).toBeInTheDocument();
      expect(within(factory).getByText(reason)).toBeInTheDocument();
      expect(within(factory).queryByRole('button', { name: 'Looks good' })).not.toBeInTheDocument();
      expect(within(factory).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    });
  });

  Scenario('mw-tbx1n.8: the badge counts only You', ({ Given, When, Then }) => {
    Given('a view with a question for him, a step waiting on the Mayor and a step waiting on the factory', seeded);
    When('the Needs screen opens inside the shell', async () => {
      render(
        <Shell route={{ view: 'needs' }}>
          <Screen />
        </Shell>,
      );
    });
    Then('the Needs you tab badge reads {string}', async (_c, count: string) => {
      const tab = await screen.findByRole('link', { name: /Needs you/ });
      await waitFor(() => expect(tab.textContent).toBe(`${count}Needs you`));
    });
  });

  Scenario("mw-tbx1n.8: a link with who=mayor opens the Mayor's list", ({ Given, When, Then }) => {
    Given('a view with a question for him, a step waiting on the Mayor and a step waiting on the factory', seeded);
    When('the address is {string} and the Needs screen opens', async (_c, search: string) => {
      window.history.replaceState(null, '', `/${search}`);
      render(<Screen />);
    });
    Then('{string} is the chosen part and its card is shown', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('tab', { name, selected: true })).toBeInTheDocument());
      await card('Merge the branch');
    });
  });
});
