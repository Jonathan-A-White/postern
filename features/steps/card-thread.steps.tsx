// features/steps/card-thread.steps.tsx — runs features/card-thread.feature (mw-q6n8m0.13): a
// reply's notification tap is resolved by the service worker's resolveTapUrl, and the route it
// names is opened on the Talk screen against a seeded Dexie. Every record class that can be a
// reply's root is driven the same way, so the Thread never says "That post is not on this phone"
// for one the phone holds.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageClass, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { parseRoute, type Route } from '../../src/nav/route';
import { resolveTapUrl } from '../../src/push/tapTarget';
import { encodeQuestion } from '../../src/services/questions';
import { applyCardRow } from '../../src/services/cards';
import { fixtureView } from '../../tests/support/cockpit-fixture';

const BASE = 1_760_000_000;
let sequence = 0;
/** The root every scenario's reply answers, and the reply itself. */
let rootRow: MessageRow;
let replyRow: MessageRow;
let route: Route;

function stored(messageClass: MessageClass, plaintext: string, extra: Partial<MessageRow> = {}): MessageRow {
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: messageClass,
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: BASE + sequence * 60,
    ciphertext: '',
    plaintext,
    direction: 'received',
    read: true,
    ...extra,
  };
}

async function hold(row: MessageRow): Promise<MessageRow> {
  await messagesRepo.put(row);
  await applyCardRow(row);
  return row;
}

const cardBody = (title: string, thread?: string) => JSON.stringify({ title, items: [{ n: 1, text: `Do the ${title}`, links: [] }], subscribe: { kinds: [], beads: [] }, ...(thread ? { thread: { bead: thread } } : {}) });

const holdCard = async (title: string, thread?: string) => {
  rootRow = await hold(stored('card', cardBody(title, thread)));
};

const reply = async (text: string, to: MessageRow = rootRow) => {
  replyRow = await hold(stored('message', JSON.stringify({ text, re: to.txid })));
};

const tap = async () => {
  route = parseRoute(new URL(await resolveTapUrl({ txid: replyRow.txid, class: 'message' }), 'https://postern.allmymind.org').search);
};

async function open(): Promise<void> {
  cleanup();
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  expect(route.view).toBe('talk');
  if (route.view !== 'talk') return;
  render(<TalkScreen thread={route.thread} root={route.root} />);
}

const opens = (where: string | undefined) => {
  expect(route).toMatchObject({ view: 'talk', root: rootRow.txid, ...(where ? { thread: where } : {}) });
};

/** The Thread is open on the root and has finished reading: the Thread subtitle names the channel. */
const threadHeader = async () => {
  await screen.findByRole('heading', { name: 'Thread' });
};

const threadShowsReply = async (text: string) => {
  await waitFor(() => expect(within(screen.getByTestId('conversation')).getByText(text)).toBeInTheDocument());
};

const noEmptyState = () => {
  expect(screen.queryByText('That post is not on this phone')).not.toBeInTheDocument();
};

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/card-thread.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    sequence = 0;
    await Promise.all([db.settings.clear(), db.messages.clear(), db.cards.clear(), db.view.clear(), db.beadDetails.clear()]);
  });

  Scenario('mw-q6n8m0.13 AC-1: the notification for a reply to a live card opens a Thread showing the card and the reply', ({ Given, And, When, Then }) => {
    Given('the phone holds the live card {string} in Factory', (_ctx, title: string) => holdCard(title));
    And('the Mayor has replied to it with {string}', (_ctx, text: string) => reply(text));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on the card', async () => {
      opens('general');
      await open();
    });
    And('the Thread shows the card {string} and under it {string}', async (_ctx, title: string, text: string) => {
      await screen.findByRole('article', { name: `Card: ${title}` });
      await threadShowsReply(text);
    });
    And('the Thread does not say {string}', () => {
      noEmptyState();
    });
  });

  Scenario('mw-q6n8m0.13 AC-2: a plain post is a thread root', ({ Given, And, When, Then }) => {
    Given('the phone holds the post {string} in Factory', async (_ctx, text: string) => {
      rootRow = await hold(stored('message', text));
    });
    And('the Mayor has replied to it with {string}', (_ctx, text: string) => reply(text));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on the post', async () => {
      opens('general');
      await open();
    });
    And('the Thread shows the post {string} and under it {string}', async (_ctx, post: string, text: string) => {
      await screen.findByText(post);
      await threadShowsReply(text);
      noEmptyState();
    });
  });

  Scenario("mw-q6n8m0.13 AC-2: a live card sent to a bead's channel opens its Thread in that channel", ({ Given, And, When, Then }) => {
    Given('the phone holds the live card {string} in the channel of bead {string}', (_ctx, title: string, bead: string) => holdCard(title, bead));
    And('the Mayor has replied to it with {string}', (_ctx, text: string) => reply(text));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on the card in the channel of bead {string}', async (_ctx, bead: string) => {
      opens(`bead:${bead}`);
      await open();
    });
    And('the Thread shows the card {string} and under it {string}', async (_ctx, title: string, text: string) => {
      await screen.findByRole('article', { name: `Card: ${title}` });
      await threadShowsReply(text);
      noEmptyState();
    });
  });

  Scenario('mw-q6n8m0.13 AC-2: a reply to a card-update is a reply to its card', ({ Given, And, When, Then }) => {
    let update: MessageRow;
    Given('the phone holds the live card {string} in Factory', (_ctx, title: string) => holdCard(title));
    And('the Mayor has updated that card', async () => {
      update = await hold(stored('card-update', JSON.stringify({ re: rootRow.txid, items: [], links: {}, tick: [] })));
    });
    And('the Mayor has replied to the update with {string}', (_ctx, text: string) => reply(text, update));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on the card', async () => {
      opens('general');
      await open();
    });
    And('the Thread shows the card {string} and under it {string}', async (_ctx, title: string, text: string) => {
      await screen.findByRole('article', { name: `Card: ${title}` });
      await threadShowsReply(text);
      noEmptyState();
    });
  });

  Scenario('mw-q6n8m0.13 AC-2: a decision card is a thread root', ({ Given, And, When, Then }) => {
    Given('the phone holds the decision card {string} on bead {string}', async (_ctx, q: string, bead: string) => {
      rootRow = await hold(stored('decision-needed', encodeQuestion({ bead, q, rec: 'In the vault', options: ['In the vault', 'In the repo'] }), { thread: `bead:${bead}` }));
    });
    And('the Mayor has replied to it with {string}', (_ctx, text: string) => reply(text));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on the decision card in the channel of bead {string}', async (_ctx, bead: string) => {
      opens(`bead:${bead}`);
      await open();
    });
    And('the Thread shows the decision card and under it {string}', async (_ctx, text: string) => {
      await screen.findByText('Where should it live?');
      await threadShowsReply(text);
      noEmptyState();
    });
  });

  Scenario('mw-q6n8m0.13 AC-2: his own message, held by Ideas only, is a thread root', ({ Given, And, When, Then }) => {
    Given('the phone holds his own message {string} in Factory', async (_ctx, text: string) => {
      rootRow = await hold(stored('message', text, { direction: 'sent' }));
    });
    And('the Mayor has replied to it with {string}', (_ctx, text: string) => reply(text));
    When('he taps the notification for that reply', async () => {
      await tap();
    });
    Then('the Thread opens on his message', async () => {
      opens('general');
      await open();
    });
    And('the Thread shows his message {string} and under it {string}', async (_ctx, post: string, text: string) => {
      await screen.findByText(post);
      await threadShowsReply(text);
      noEmptyState();
    });
  });

  Scenario('mw-q6n8m0.13 AC-2: a card with no reply yet still opens as a Thread, with the card and the composer', ({ Given, When, Then, And }) => {
    Given('the phone holds the live card {string} in Factory', (_ctx, title: string) => holdCard(title));
    When('the Thread of that card is opened from a link', async () => {
      route = { view: 'talk', thread: 'general', root: rootRow.txid };
      await open();
    });
    Then('the Thread shows the card {string}', async (_ctx, title: string) => {
      await threadHeader();
      await screen.findByRole('article', { name: `Card: ${title}` });
    });
    And('the Thread does not say {string}', () => {
      noEmptyState();
    });
    And('the Thread offers a Reply box', async () => {
      expect(await screen.findByPlaceholderText('Reply…')).toBeInTheDocument();
    });
  });
});
