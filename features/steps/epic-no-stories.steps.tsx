// features/steps/epic-no-stories.steps.tsx — runs features/epic-no-stories.feature (mw-gq6.159):
// a held epic with no stories offers no Release on its bead page, its Needs you card or the Map.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { indexView } from '../../src/model/tree';
import type { Need, View } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

// The fixture's epic mw-f758y.31 holds .31.2, .31.3 and .31.4.
const EPIC = 'mw-f758y.31';
const STORIES = ['mw-f758y.31.1', 'mw-f758y.31.2', 'mw-f758y.31.3', 'mw-f758y.31.4'];
const DEFERRED_STORY = 'mw-f758y.31.2';

/** The fixture view with the epic deferred and only the given stories left under it, all others removed. */
function viewWithStories(keep: string[]): View {
  const at = Date.now() - 60_000;
  const view = fixtureView(at);
  view.written_at = new Date(at).toISOString();
  view.beads = view.beads.filter((bead) => !STORIES.includes(bead.id) || keep.includes(bead.id));
  for (const bead of view.beads) {
    if (bead.id === EPIC) bead.status = 'deferred';
    else if (keep.includes(bead.id)) bead.status = 'deferred';
  }
  return view;
}

async function storeView(view: View): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.parse(view.written_at) });
}

const approve: Need = { kind: 'approve', bead: EPIC, epic: '', title: 'Cockpit screens', since: new Date(Date.now() - 60_000).toISOString(), text: '', recommended: 'Release', options: ['Release'], blocks: 0, steps: [] };

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/epic-no-stories.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.settings.clear()]);
  });

  const offers = async (_c: unknown, label: string) => {
    expect(await screen.findByRole('button', { name: label })).toBeEnabled();
  };

  Scenario('mw-gq6.159 AC1: a deferred epic with no stories shows no Release and says the Mayor drafts them', ({ Given, Then }) => {
    Given('the bead page of a deferred epic with no stories', async () => {
      await storeView(viewWithStories([]));
      render(<BeadScreen id={EPIC} />);
    });
    Then('the page has no Release button and says {string}', async (_c, said: string) => {
      expect(await screen.findByText(said)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
    });
  });

  Scenario('mw-gq6.159 AC2: a deferred epic with one held story shows Release 1 held', ({ Given, Then, And }) => {
    Given('the bead page of a deferred epic with one held story', async () => {
      await storeView(viewWithStories([DEFERRED_STORY]));
      render(<BeadScreen id={EPIC} />);
    });
    Then('the page offers the button {string}', offers);
    And('the page does not say {string}', async (_c, said: string) => {
      expect(screen.queryByText(said)).toBeNull();
    });
  });

  Scenario('mw-gq6.159 AC3: a deferred story still shows its own Release', ({ Given, Then }) => {
    Given('the bead page of a deferred story', async () => {
      await storeView(viewWithStories(STORIES));
      render(<BeadScreen id={DEFERRED_STORY} />);
    });
    Then('the page offers the button {string}', offers);
  });

  Scenario('mw-gq6.159 AC4: the Needs you card for an epic with no stories offers no Release', ({ Given, Then }) => {
    Given('a release card for an epic with no stories', async () => {
      render(<NeedCard need={approve} index={indexView(viewWithStories([]))} />);
    });
    Then('the card has no Release button and says {string}', async (_c, said: string) => {
      const card = screen.getByTestId('need-card');
      expect(within(card).queryByRole('button', { name: /^Release/ })).toBeNull();
      expect(within(card).getByText(said)).toBeInTheDocument();
    });
  });

  Scenario('mw-gq6.159 AC4: the Map page of a deferred epic with no stories offers no Release', ({ Given, Then }) => {
    Given('the Map opened on a deferred epic with no stories', async () => {
      await storeView(viewWithStories([]));
      render(<MapScreen focus={EPIC} />);
    });
    Then('the Map has no Release button', async () => {
      await screen.findByText('Discuss');
      expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
    });
  });
});
