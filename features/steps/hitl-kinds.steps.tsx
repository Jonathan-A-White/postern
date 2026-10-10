// features/steps/hitl-kinds.steps.tsx — runs features/hitl-kinds.feature (mw-42919u):
// a bead labelled hitl plus hitl:review or hitl:decision is a need of that kind in the view.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { NEED_META } from '../../src/cockpit/labels';
import { decodeView, NEED_KINDS, type Need } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const BODY = 'Do this: open the pull request and approve it. Done when: the PR shows Approved.';

function wire(kind: 'review' | 'decision'): Record<string, unknown> {
  return { kind, bead: 'mw-ask.1', epic: '', title: 'A thing waiting on you', since: new Date(Date.now() - 60_000).toISOString(), text: BODY, recommended: '', options: [], blocks: 0, waits_for: 'you' };
}

/** The need as the app decodes it from a view the host wrote. */
function decoded(kind: 'review' | 'decision'): Need {
  const view = { ...fixtureView(), needs: [wire(kind)] };
  const [need] = decodeView(JSON.stringify(view)).needs;
  if (!need) throw new Error(`a ${kind} need was dropped from the view`);
  return need;
}

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/hitl-kinds.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => {
    cleanup();
  });

  const chipped = async (_c: unknown, label: string) => {
    const card = screen.getByTestId('need-card');
    const kind = label === 'Review' ? 'review' : 'decision';
    expect(NEED_META[kind].label).toBe(label);
    expect(within(card).getByText(label)).toBeInTheDocument();
    expect(card.querySelector('svg')).not.toBeNull();
  };
  const sections = async () => {
    const card = screen.getByTestId('need-card');
    const parts = within(card).getByTestId('hitl-body');
    expect(within(parts).getByText('Do this')).toBeInTheDocument();
    expect(within(parts).getByText('open the pull request and approve it.')).toBeInTheDocument();
    expect(within(parts).getByText('Done when')).toBeInTheDocument();
    expect(within(parts).getByText('the PR shows Approved.')).toBeInTheDocument();
  };

  Scenario('mw-42919u: a review need is decoded and drawn with its own chip and the body\'s Do this and Done when', ({ Given, Then, And }) => {
    Given("the view carries a review need whose body says Do this and Done when", async () => {
      render(<NeedCard need={decoded('review')} />);
    });
    Then('the card is chipped {string} with its own icon', chipped);
    And('the card shows Do this and Done when as labelled parts', sections);
  });

  Scenario('mw-42919u: a decision need is decoded and drawn with its own chip and the body\'s Do this and Done when', ({ Given, Then, And }) => {
    Given("the view carries a decision need whose body says Do this and Done when", async () => {
      render(<NeedCard need={decoded('decision')} />);
    });
    Then('the card is chipped {string} with its own icon', chipped);
    And('the card shows Do this and Done when as labelled parts', sections);
  });

  Scenario('mw-42919u: the review and decision chips differ from every other kind', ({ Given, Then }) => {
    Given('the view carries a review need and a decision need', async () => {
      expect(decoded('review').kind).toBe('review');
      expect(decoded('decision').kind).toBe('decision');
    });
    Then('no two kinds share a label or an icon', async () => {
      const metas = NEED_KINDS.map((kind) => NEED_META[kind]);
      expect(new Set(metas.map((m) => m.label)).size).toBe(metas.length);
      expect(new Set(metas.map((m) => m.icon)).size).toBe(metas.length);
    });
  });

  Scenario("mw-42919u: protocol.md's Needs-you table lists review and decision", ({ Given, Then }) => {
    let table = '';
    Given("docs/protocol.md's Needs-you table", async () => {
      const doc = readFileSync('docs/protocol.md', 'utf8');
      const start = doc.indexOf('`needs` — everything waiting on the Governor');
      const end = doc.indexOf('The table is also the kinds', start);
      table = doc.slice(start, end);
      expect(table).not.toBe('');
    });
    Then('it lists the kinds {string} and {string}', async (_c, a: string, b: string) => {
      expect(table).toContain(`| \`${a}\` |`);
      expect(table).toContain(`| \`${b}\` |`);
    });
  });
});
