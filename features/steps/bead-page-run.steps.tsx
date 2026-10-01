// features/steps/bead-page-run.steps.tsx — runs features/bead-page-run.feature (mw-gq6.177).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView, handsStep } from '../../tests/support/cockpit-fixture';
import type { Need } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-h';

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/bead-page-run.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  });

  Scenario("mw-gq6.177: the step's comment on the bead's page has Approve and run under its commands", ({ Given, When, Then }) => {
    Given('a hands step on a bead, listed for him and not yet run, with its comment on the bead', async () => {
      const now = Date.now();
      const step = handsStep(BEAD, { id: 'backend-419ee98', host: 'laptop', as: 'user', run: 'echo hi', way_back: '' });
      const need: Need = { kind: 'hands', bead: BEAD, epic: '', title: 'Run it', since: new Date(now - 3_600_000).toISOString(), text: '', recommended: '', options: [], blocks: 0, steps: [step], waits_for: 'you' };
      const bead = { id: BEAD, title: 'Run it', type: 'task', status: 'open', priority: 2, labels: ['hitl'], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 1, done_earlier: 0 };
      await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [need], beads: [bead] }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      const detail = { v: 2, id: BEAD, title: 'Run it', type: 'task', status: 'open', priority: 2, labels: ['hitl'], comments: [{ at: new Date(now - 60_000).toISOString(), author: 'mw', text: `HANDS STEP ${step.id} on laptop as user:\n\`\`\`sh\necho hi\n\`\`\`` }] };
      await db.beadDetails.put({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: now });
    });
    When("the bead's page opens", async () => {
      render(<BeadScreen id={BEAD} />);
    });
    Then('the comment shows {string} under its commands', async (_c, name: string) => {
      const under = await screen.findByLabelText('Run backend-419ee98');
      expect(within(under).getByRole('button', { name })).toBeInTheDocument();
    });
  });
});
