// features/steps/bead-links.steps.tsx — runs features/bead-links.feature (mw-tbx1n.11):
// the Talk screen over a seeded Dexie, one message whose text names beads.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();
let seeded: MessageRow[] = [];

function generalMessage(text: string): MessageRow {
  return {
    id: `${'ef'.repeat(32)}:0`,
    txid: 'ef'.repeat(32),
    vout: 0,
    seq: 1,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
  };
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/bead-links.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    now = Date.now();
    seeded = [];
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    window.history.replaceState(null, '', '/?v=talk&t=general');
  });

  Scenario("mw-tbx1n.11: a bead id in a Talk message is a link to that bead's page", ({ Given, When, Then }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(text));
    });
    When('the general thread is opened', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      for (const row of seeded) await messagesRepo.put(row);
      render(<TalkScreen thread="general" />);
      await screen.findByTestId('conversation');
    });
    Then('the message shows a link {string} to the bead page of {string} and no link for {string}', async (_c, name: string, id: string, plain: string) => {
      const conversation = screen.getByTestId('conversation');
      const link = await within(conversation).findByRole('link', { name });
      expect(link).toHaveAttribute('href', `?v=bead&id=${id}`);
      expect(within(conversation).queryByRole('link', { name: plain })).toBeNull();
      expect(within(conversation).getByText(plain).tagName).toBe('CODE');
    });
  });
});
