// features/steps/bead-release-path.steps.tsx — runs features/bead-release-path.feature (mw-tcmhmh.1):
// the bead page's Release needs a path (a rig and a target branch) to release into.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const BEAD = 'mw-f758y.31.2';

/** Store a live view whose held story has the given path edit. */
async function storeViewWith(edit: (path: { rig: string; branch: string }) => void): Promise<void> {
  const view = fixtureView();
  const bead = view.beads.find((b) => b.id === BEAD);
  if (!bead?.path) throw new Error('fixture bead missing');
  edit(bead.path);
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
}

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/bead-release-path.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
  });

  const open = async () => {
    render(<BeadScreen id={BEAD} />);
    await screen.findByLabelText('Actions');
    await screen.findByText('Priority');
  };

  Scenario('mw-tcmhmh.1: a held story with a path offers Release', ({ Given, Then }) => {
    Given('the bead page of a held story with a rig and a branch', async () => {
      await storeViewWith(() => undefined);
      await open();
    });
    Then('the page offers the button {string}', async (_c, label: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
    });
  });

  const refuses = async () => {
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
  };

  Scenario('mw-tcmhmh.1: a held bead with no path has no Release button', ({ Given, Then }) => {
    Given('the bead page of a held bead with no path', async () => {
      await storeViewWith((path) => Object.assign(path, { rig: '', branch: '' }));
      await open();
    });
    Then('the page has no Release button', refuses);
  });

  Scenario('mw-tcmhmh.1: a held bead with a rig but no branch has no Release button', ({ Given, Then }) => {
    Given('the bead page of a held bead with a rig but no branch', async () => {
      await storeViewWith((path) => Object.assign(path, { branch: '' }));
      await open();
    });
    Then('the page has no Release button', refuses);
  });

  Scenario('mw-tcmhmh.1: a held bead with a branch but no rig has no Release button', ({ Given, Then }) => {
    Given('the bead page of a held bead with a branch but no rig', async () => {
      await storeViewWith((path) => Object.assign(path, { rig: '' }));
      await open();
    });
    Then('the page has no Release button', refuses);
  });
});
