// features/steps/needs-at-size.steps.tsx — runs features/needs-at-size.feature (mw-ev7oyy.43): Needs you inside
// the shell on a stored view of the live view's shape (tests/support/live-shape-view.ts), counting how often the
// stored view's text is parsed. The time it takes on a phone's screen is tests/e2e/needs-at-size.spec.ts.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterAll, expect, vi, type MockInstance } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { Shell } from '../../src/cockpit/Shell';
import { viewRepo } from '../../src/data/repositories';
import { needsByWaiter, splitFolded } from '../../src/model/needs';
import { emptyPhone } from '../../tests/support/empty-phone';
import { liveShapeView } from '../../tests/support/live-shape-view';
import { SLOW_HOST_MS } from '../../tests/support/wait-for-route';

let plaintext = '';
let his = 0;
let parse: MockInstance<typeof JSON.parse> | undefined;

afterAll(() => {
  parse?.mockRestore();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/needs-at-size.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    await emptyPhone();
    window.history.replaceState(null, '', '/?v=needs');
  });

  Scenario('mw-ev7oyy.43: Needs you with 150 cards decodes the stored view once, not once a card', ({ Given, When, Then, And }) => {
    Given("a stored view of the live view's shape with 150 needs, none folded", async () => {
      const now = Date.now();
      const view = liveShapeView(now, { needs: 150, beads: 1252, folded: 0 });
      his = needsByWaiter(splitFolded(view.needs).open).you.length;
      plaintext = JSON.stringify(view);
      await viewRepo.save({ plaintext, written_at: view.written_at, source: 'live', fetchedAt: now });
    });
    When('Needs you opens inside the shell', async () => {
      parse = vi.spyOn(JSON, 'parse');
      render(
        <Shell route={{ view: 'needs' }}>
          <NeedsScreen />
        </Shell>,
      );
      await screen.findAllByTestId('need-card', undefined, { timeout: SLOW_HOST_MS });
    });
    Then('every card waiting on him is shown', async () => {
      expect(his).toBeGreaterThan(100);
      await waitFor(() => expect(screen.getAllByTestId('need-card')).toHaveLength(his), { timeout: SLOW_HOST_MS });
    });
    And('the stored view was decoded once', () => {
      const ofTheView = parse?.mock.calls.filter(([text]) => text === plaintext).length;
      expect(ofTheView).toBe(1);
    });
  });
});
