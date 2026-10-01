// features/steps/epic-page-release.steps.tsx — runs features/epic-page-release.feature (mw-gq6.157):
// an epic's bead page offers the Map's 'Release N held' for the stories held under it.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { forgetOutboxState } from '../../src/services/outbox';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { deliverAction } from '../../src/services/deliver';
import { fixtureView } from '../../tests/support/cockpit-fixture';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

// The fixture's epic mw-f758y.31 holds .31.2 (behind the open .31.1), .31.3 and .31.4.
const EPIC = 'mw-f758y.31';
const DEFERRED_STORY = 'mw-f758y.31.2';

/** Stores the fixture view with the epic's stories at the given statuses. */
async function storeView(statuses: Record<string, string>): Promise<void> {
  const at = Date.now() - 60_000;
  const view = fixtureView(at);
  view.written_at = new Date(at).toISOString();
  for (const bead of view.beads) if (bead.id in statuses) bead.status = statuses[bead.id];
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: at });
}

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/epic-page-release.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    forgetOutboxState();
    vi.mocked(deliverAction).mockClear();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.settings.clear(), db.outbox.clear()]);
  });

  const offers = async (_c: unknown, label: string) => {
    expect(await screen.findByRole('button', { name: label })).toBeEnabled();
  };

  Scenario('mw-gq6.157 AC1: an epic page with two held stories offers Release 2 held and sends the release', ({ Given, Then, When }) => {
    Given('the bead page of an epic with two held stories, one behind an open blocker', async () => {
      await storeView({ 'mw-f758y.31.4': 'open' });
      render(<BeadScreen id={EPIC} />);
    });
    Then('the page offers the button {string}', offers);
    When('he taps {string}', async (_c, label: string) => {
      await userEvent.click(await screen.findByRole('button', { name: label }));
    });
    Then('the release for the epic is sent', async () => {
      await waitFor(() => expect(deliverAction).toHaveBeenCalledWith({ action: 'release', bead: EPIC }, expect.anything()));
    });
  });

  Scenario('mw-gq6.157 AC2: an epic page with no held stories offers no Release', ({ Given, Then }) => {
    Given('the bead page of an epic with no held stories', async () => {
      await storeView({ 'mw-f758y.31.2': 'open', 'mw-f758y.31.3': 'open', 'mw-f758y.31.4': 'open' });
      render(<BeadScreen id={EPIC} />);
    });
    Then('the page has no Release button', async () => {
      await screen.findByLabelText('Actions');
      await screen.findByText('Priority');
      expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
    });
  });

  Scenario("mw-gq6.157 AC3: a deferred story's page still offers a plain Release", ({ Given, Then }) => {
    Given('the bead page of a deferred story', async () => {
      await storeView({});
      render(<BeadScreen id={DEFERRED_STORY} />);
    });
    Then('the page offers the button {string}', offers);
  });
});
