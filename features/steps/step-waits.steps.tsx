// features/steps/step-waits.steps.tsx — runs features/step-waits.feature (mw-tbx1n.9):
// a step for his hands whose bead waits on an open bead shows what it waits on and
// offers nothing to tap, on the Needs screen and on the bead's page.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView, handsStep } from '../../tests/support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-h';
const BLOCKER = 'mw-b';

function viewBead(id: string, title: string, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

async function save(opts: { waitsOn?: string; failed?: boolean }): Promise<void> {
  const now = Date.now();
  const base = { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: '' };
  const step = handsStep(BEAD, opts.failed ? { ...base, ran: { at: new Date(now - 60_000).toISOString(), exit: 1, host: 'desktop' } } : base);
  const waiting = opts.waitsOn !== undefined;
  const need: Need = {
    kind: 'hands',
    bead: BEAD,
    epic: '',
    title: 'Enable linger',
    since: new Date(now - 3_600_000).toISOString(),
    text: '',
    recommended: '',
    options: [],
    blocks: 0,
    steps: [step],
    ...(waiting ? { waits_for: 'factory' as const, not_ready: true, waiting_on: [opts.waitsOn as string] } : { waits_for: 'you' as const }),
  };
  const beads = [viewBead(BEAD, 'Enable linger', { labels: ['hitl'], waits: waiting ? [BLOCKER] : [] }), ...(waiting ? [viewBead(BLOCKER, opts.waitsOn as string)] : [])];
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [need], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/step-waits.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const waiting = async (_c: unknown, title: string) => save({ waitsOn: title });
  const stepCard = async () => {
    const card = await screen.findByRole('listitem', { name: 'Step linger' });
    return card;
  };
  const noTaps = async () => {
    const card = await stepCard();
    for (const name of ['Approve and run', 'Approve and run again', 'I did it myself', 'Done']) {
      expect(within(card).queryByRole('button', { name })).toBeNull();
    }
    const article = card.closest('article') as HTMLElement;
    expect(within(article).queryByRole('button', { name: 'Done' })).toBeNull();
  };
  const waitsLine = async (_c: unknown, line: string) => {
    const card = await stepCard();
    const text = line.replace(/^Waits on: /, '');
    await waitFor(() => expect(card.textContent).toContain(line));
    const link = within(card).getByRole('link', { name: text });
    expect(link.getAttribute('href')).toContain(BLOCKER);
  };
  const beadPage = async () => {
    render(<BeadScreen id={BEAD} />);
  };

  Scenario('mw-tbx1n.9: a step whose bead waits shows Waits on: <title> and no Approve and run', ({ Given, When, Then, And }) => {
    Given('a step for his hands whose bead waits on the open bead {string}', waiting);
    When('the Needs screen opens on the Factory list', async () => {
      window.history.replaceState(null, '', '/?v=needs&who=factory');
      render(<NeedsScreen who="factory" />);
    });
    Then('the step says {string} with the title a link to that bead', waitsLine);
    And('the step offers no {string}, {string}, {string} or {string}', noTaps);
  });

  Scenario("mw-tbx1n.9: on the bead's page too", ({ Given, When, Then, And }) => {
    Given('a step for his hands whose bead waits on the open bead {string}', waiting);
    When("the bead's page opens", beadPage);
    Then('the step says {string} with the title a link to that bead', waitsLine);
    And('the step offers no {string}, {string}, {string} or {string}', noTaps);
  });

  Scenario('mw-tbx1n.9: a step that failed on a bead that now waits cannot be run again', ({ Given, When, Then, And }) => {
    Given('a step for his hands that failed, whose bead now waits on the open bead {string}', async (_c, title: string) => save({ waitsOn: title, failed: true }));
    When("the bead's page opens", beadPage);
    Then('the step says {string} with the title a link to that bead', waitsLine);
    And('the step offers no {string}, {string}, {string} or {string}', noTaps);
  });

  Scenario('mw-tbx1n.9: a step whose bead waits on nothing is tapped as before', ({ Given, When, Then }) => {
    Given('a step for his hands whose bead waits on nothing', async () => save({}));
    When("the bead's page opens", beadPage);
    Then('the step offers {string} and {string} and says nothing of waiting', async (_c, approve: string, self: string) => {
      const card = await stepCard();
      expect(within(card).getByRole('button', { name: approve })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: self })).toBeInTheDocument();
      expect(card.textContent).not.toContain('Waits on');
    });
  });
});
