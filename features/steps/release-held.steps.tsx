// features/steps/release-held.steps.tsx — runs features/release-held.feature (mw-tbx1n.19):
// a release card offers Release only while its story is still held (deferred).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { indexView } from '../../src/model/tree';
import type { Need } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const BEAD = 'mw-f758y.31.2';

const approve: Need = { kind: 'approve', bead: BEAD, epic: '', title: 'Map zoom', since: new Date(Date.now() - 60_000).toISOString(), text: '', recommended: 'Release', options: ['Release'], blocks: 0, steps: [] };

/** The live view with the story at the given status. */
function viewWith(status: string) {
  const view = fixtureView();
  const bead = view.beads.find((b) => b.id === BEAD);
  if (!bead) throw new Error('fixture bead missing');
  bead.status = status;
  return indexView(view);
}

const EPIC = 'mw-f758y.31';

/** The epic's stories at the given status for one of them and open for the rest. */
function epicWith(held: string, status: string) {
  const view = fixtureView();
  for (const bead of view.beads) if (bead.parent === EPIC) bead.status = bead.id === held ? status : 'open';
  return indexView(view);
}

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/release-held.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    await Promise.all([db.settings.clear(), db.answers.clear(), db.messages.clear()]);
  });

  const cardFor = async (_c: unknown, status: string) => {
    render(<NeedCard need={approve} index={viewWith(status)} />);
  };
  const offers = async (_c: unknown, label: string) => {
    expect(within(screen.getByTestId('need-card')).getByRole('button', { name: label })).toBeEnabled();
  };
  const refuses = async (_c: unknown, said: string) => {
    const card = screen.getByTestId('need-card');
    expect(within(card).queryByRole('button', { name: 'Release' })).toBeNull();
    expect(within(card).getByText(said)).toBeInTheDocument();
  };

  Scenario('mw-tbx1n.19: a release card for a deferred story offers Release', ({ Given, Then }) => {
    Given('a release card whose story is {string}', cardFor);
    Then('the card offers the button {string}', offers);
  });

  Scenario('mw-tbx1n.19: a release card for a building story says Already released: building', ({ Given, Then }) => {
    Given('a release card whose story is {string}', cardFor);
    Then('the card has no Release button and says {string}', refuses);
  });

  Scenario('mw-tbx1n.19: a release card for an open story says Already released', ({ Given, Then }) => {
    Given('a release card whose story is {string}', cardFor);
    Then('the card has no Release button and says {string}', refuses);
  });

  Scenario('mw-tbx1n.19: a release card whose story is not known still offers Release', ({ Given, Then }) => {
    Given('a release card whose story is not in the view', async () => {
      render(<NeedCard need={approve} />);
    });
    Then('the card offers the button {string}', offers);
  });

  Scenario("mw-tbx1n.19: the bead page's fresher status wins over the view's", ({ Given, Then }) => {
    Given('a release card whose view says {string} but whose bead page says {string}', async (_c, viewSays: string, pageSays: string) => {
      render(<NeedCard need={approve} index={viewWith(viewSays)} status={pageSays} />);
    });
    Then('the card has no Release button and says {string}', refuses);
  });

  for (const title of ['a release card for an epic with a held story under it offers Release', 'a release card for an epic with no held story left says Already released']) {
    Scenario(`mw-tbx1n.19: ${title}`, ({ Given, Then }) => {
      Given('a release card for an epic whose story {string} is {string} and whose other stories are open', async (_c, story: string, status: string) => {
        render(<NeedCard need={{ ...approve, bead: EPIC }} index={epicWith(story, status)} />);
      });
      if (title.includes('offers')) Then('the card offers the button {string}', offers);
      else Then('the card has no Release button and says {string}', refuses);
    });
  }
});
