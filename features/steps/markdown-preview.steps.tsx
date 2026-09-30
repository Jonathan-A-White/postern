// features/steps/markdown-preview.steps.tsx — runs features/markdown-preview.feature
// (mw-hy6f4.6): the Talk screen over a seeded Dexie, one message whose text is Markdown.
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
    id: `${'cd'.repeat(32)}:0`,
    txid: 'cd'.repeat(32),
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

const feature = await loadFeature('features/markdown-preview.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    now = Date.now();
    seeded = [];
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    window.history.replaceState(null, '', '/?v=talk');
  });

  Scenario('mw-hy6f4.6 AC2: a Talk row whose last message is Markdown shows it without the markers', ({ Given, When, Then }) => {
    Given("the Mayor's last word in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(text));
    });
    When('Talk opens', async () => {
      await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      for (const row of seeded) await messagesRepo.put(row);
      render(<TalkScreen thread={undefined} />);
      await screen.findByTestId('thread-list');
    });
    Then('the Factory row previews {string}', async (_c, preview: string) => {
      const list = screen.getByTestId('thread-list');
      const row = (await within(list).findByText('Factory')).closest('a') as HTMLElement;
      expect(await within(row).findByText(preview)).toBeInTheDocument();
    });
  });
});
