// features/steps/unread-closed.steps.tsx — runs features/unread-closed.feature (mw-mr4xgrw.55): Needs you's
// 'Unread from the Mayor' against the fixture view, with unread rows seeded on a closed and an open bead.
// See gate.steps.tsx for why dont-cleanup-after-each is imported and cleanup() called by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { forgetLastKnown } from '../../src/cockpit/lastKnown';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const feature = await loadFeature('features/unread-closed.feature');

const CLOSED = 'bead:mw-f758y.30.1';
const OPEN = 'bead:mw-f758y.30.2';
const TOPIC = 'topic:launch plan';
const DAY = 86_400;

let sequence = 0;
function row(thread: string, ago: number, plaintext: string): MessageRow {
  sequence += 1;
  const txid = `${'ef'.repeat(31)}${String(sequence).padStart(2, '0')}`;
  return {
    id: `${txid}:0`, txid, vout: 0, seq: sequence, class: 'message', to: '02'.padEnd(66, '0'), from: '03'.padEnd(66, '0'),
    ts: Math.floor(Date.now() / 1000) - ago, ciphertext: '', plaintext, direction: 'received', read: false, thread,
  };
}

async function seed(rows: MessageRow[]): Promise<void> {
  cleanup();
  forgetLastKnown();
  sequence = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.messages.clear(), db.answers.clear(), db.cards.clear()]);
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const r of rows) await messagesRepo.put(r);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => cleanup());

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC1 and AC3: a closed bead\'s thread quiet for 8 days is not listed, an open bead\'s is', ({ Given, When, Then }) => {
    Given('an unread thread on a closed bead quiet for 8 days and an unread thread on an open bead quiet for 8 days', () =>
      seed([row(CLOSED, 8 * DAY, 'Closed bead words'), row(OPEN, 8 * DAY, 'Open bead words')]));
    When('Needs you is opened', () => {
      render(<NeedsScreen />);
    });
    Then('"Unread from the Mayor" lists the open bead\'s thread and not the closed bead\'s', async () => {
      const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
      expect(within(section).getByText('Open bead words')).toBeInTheDocument();
      expect(within(section).queryByText('Closed bead words')).toBeNull();
    });
  });

  Scenario('AC2: Mark all read marks every listed thread read', ({ Given, When, And, Then }) => {
    Given('an unread thread on an open bead and an unread topic thread', () => seed([row(OPEN, 60, 'Open words'), row(TOPIC, 120, 'Topic words')]));
    When('Needs you is opened', () => {
      render(<NeedsScreen />);
    });
    And('I tap "Mark all read"', async () => {
      const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
      fireEvent.click(within(section).getByRole('button', { name: 'Mark all read' }));
    });
    Then('both threads are read and "Unread from the Mayor" is gone', async () => {
      await waitFor(async () => expect((await messagesRepo.getAllOldestFirst()).filter((r) => !r.read)).toHaveLength(0));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Unread from the Mayor' })).toBeNull());
    });
  });
});
