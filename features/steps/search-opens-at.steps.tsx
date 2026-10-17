// features/steps/search-opens-at.steps.tsx — runs features/search-opens-at.feature (mw-ev7oyy.38): Search,
// the Talk screen and the bead screen as the router puts them, on a phone that holds hundreds of messages. A
// tap on a result is a real click on its link; what opens is read off the screen: the item found is drawn
// (data-found marks it) however far back it sits. jsdom does no layout, so where the box is scrolled to is
// asked of the Conversation alone (features/conversation-scroll.feature).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { SearchScreen } from '../../src/cockpit/SearchScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { type MessageRow } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
import { encodeThreadedMessage } from '../../src/services/threads';
import { useRoute } from '../../src/router';
import { fixtureDetail, fixtureView } from '../../tests/support/cockpit-fixture';
import { emptyPhone } from '../../tests/support/empty-phone';
import { waitForRoute } from '../../tests/support/wait-for-route';

const BEAD = 'mw-2rbm.10';
const TOTAL = 150;

const txidOf = (n: number) => `${'cd'.repeat(30)}${String(n).padStart(4, '0')}`;

function row(n: number, over: Partial<MessageRow> = {}): MessageRow {
  const txid = txidOf(n);
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: n,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: 1_760_000_000 + n * 60,
    ciphertext: '',
    plaintext: `Message ${n}`,
    direction: 'received',
    read: true,
    ...over,
  };
}

/** TOTAL messages in a channel (`thread` undefined is Factory), the `at`th saying `words`. */
async function channelOf(thread: string | undefined, at: number, words: string): Promise<void> {
  for (let n = 1; n <= TOTAL; n += 1) await messagesRepo.put(row(n, { ...(thread ? { thread } : {}), plaintext: n === at ? words : `Message ${n}` }));
}

/** The place the address names, as App draws it. */
// eslint-disable-next-line react-refresh/only-export-components
function Places() {
  const route = useRoute();
  switch (route.view) {
    case 'search':
      return <SearchScreen q={route.q} />;
    case 'talk':
      return <TalkScreen thread={route.thread} root={route.root} prefill={route.prefill} msg={route.msg} />;
    case 'bead':
      return <BeadScreen key={`${route.id}|${route.msg ?? ''}`} id={route.id} msg={route.msg} />;
    default:
      return <p>{route.view}</p>;
  }
}

async function start(): Promise<void> {
  cleanup();
  await emptyPhone();
  forgetOutboxState();
  const view = fixtureView();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  window.history.replaceState(null, '', '/?v=search');
}

/** Types into Search and taps the first result under `group`. */
async function searchAndTap(words: string, group: string): Promise<void> {
  render(<Places />);
  await userEvent.type(await screen.findByRole('searchbox'), words);
  const hits = await screen.findByRole('region', { name: group });
  await userEvent.click(within(hits).getAllByRole('link')[0]);
}

/** The one thing marked as found is on the screen and says `words`. */
async function foundSays(words: string): Promise<void> {
  await waitFor(() => {
    const found = document.querySelector('[data-found]');
    expect(found).not.toBeNull();
    expect(found).toHaveTextContent(words);
  });
  expect(document.querySelectorAll('[data-found]')).toHaveLength(1);
}

afterAll(() => cleanup());

const feature = await loadFeature('features/search-opens-at.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(start);

  Scenario("mw-ev7oyy.38 AC1: a message older than the channel's first page opens at it, marked", ({ Given, When, Then, And }) => {
    Given('Factory holds 150 messages, and the 20th, older than the newest 60, says "I have this David Allan black book"', () => channelOf(undefined, 20, 'I have this David Allan black book I wonder if we could'));
    When('"Allan" is typed into Search and the Factory message under Messages is tapped', () => searchAndTap('Allan', 'Messages'));
    Then('Factory opens with the "David Allan black book" message on the screen, marked as the one found', () => foundSays('David Allan black book'));
    And('the newest message is not the one marked', () => {
      expect(document.querySelector('[data-found]')).not.toHaveTextContent(`Message ${TOTAL}`);
    });
  });

  Scenario("mw-ev7oyy.38 AC2: a message on the channel's first page opens at it too", ({ Given, When, Then }) => {
    Given('Factory holds 150 messages, and the 140th says "delete coins"', () => channelOf(undefined, 140, 'delete coins from the list'));
    When('"coins" is typed into Search and the Factory message under Messages is tapped', () => searchAndTap('coins', 'Messages'));
    Then('Factory opens with the "delete coins" message on the screen, marked as the one found', () => foundSays('delete coins'));
  });

  Scenario('mw-ev7oyy.38 sweep: a reply in a thread opens its thread at the reply, marked', ({ Given, When, Then }) => {
    Given('Factory holds a post with a reply saying "the Allan chapter is next"', async () => {
      await messagesRepo.put(row(1, { plaintext: 'Which books next?' }));
      await messagesRepo.put(row(2, { plaintext: encodeThreadedMessage({ text: 'the Allan chapter is next', re: txidOf(1) }) }));
    });
    When('"Allan" is typed into Search and the Factory message under Messages is tapped', () => searchAndTap('Allan', 'Messages'));
    Then('the thread of the post opens with the "Allan chapter" reply on the screen, marked as the one found', async () => {
      await foundSays('the Allan chapter is next');
      await waitForRoute({ view: 'talk', thread: 'general', root: txidOf(1), msg: txidOf(2) });
      expect(screen.getByText('Which books next?')).toBeInTheDocument();
    });
  });

  Scenario("mw-ev7oyy.38 sweep: a message in a bead's channel opens that channel at it, marked", ({ Given, When, Then }) => {
    Given("the bead's channel holds 150 messages, and the 20th says \"pelican\"", () => channelOf(`bead:${BEAD}`, 20, 'a pelican in the library'));
    When('"pelican" is typed into Search and the message under Messages is tapped', () => searchAndTap('pelican', 'Messages'));
    Then('the bead\'s channel opens with the "pelican" message on the screen, marked as the one found', () => foundSays('a pelican in the library'));
  });

  Scenario('mw-ev7oyy.38 sweep: a comment result opens its bead at the comment, marked', ({ Given, When, Then }) => {
    Given('a bead holds 150 messages and a comment saying "ostrich"', async () => {
      await channelOf(`bead:${BEAD}`, 0, '');
      const detail = fixtureDetail(BEAD)!;
      const comments = [{ at: '2025-10-01T00:00:00Z', author: 'mw@desktop', text: 'An ostrich settled the question.' }];
      await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify({ ...detail, comments }), fetchedAt: Date.now() });
    });
    When('"ostrich" is typed into Search and the comment under Descriptions and comments is tapped', () => searchAndTap('ostrich', 'Descriptions and comments'));
    Then('the bead opens with the "ostrich" comment on the screen, marked as the one found', () => foundSays('An ostrich settled the question.'));
  });

  Scenario('mw-ev7oyy.38 sweep: a bead result opens that bead', ({ Given, When, Then }) => {
    Given('the view holds the bead "mw-2rbm.10"', () => undefined);
    When('"BSV library" is typed into Search and the bead under Beads is tapped', () => searchAndTap('BSV library', 'Beads'));
    Then('the bead screen for "mw-2rbm.10" is opened', () => waitForRoute({ view: 'bead', id: BEAD }));
  });

  Scenario('mw-ev7oyy.38: a link that names a message the phone does not hold opens the channel as usual', ({ Given, When, Then }) => {
    Given('Factory holds 150 messages, and the 20th, older than the newest 60, says "I have this David Allan black book"', () => channelOf(undefined, 20, 'I have this David Allan black book'));
    When('Factory is opened at a message that is not there', () => {
      window.history.replaceState(null, '', `/?v=talk&t=general&m=${txidOf(999)}`);
      render(<Places />);
    });
    Then('Factory opens at its newest message and nothing is marked', async () => {
      expect(await screen.findByText(`Message ${TOTAL}`)).toBeInTheDocument();
      expect(document.querySelector('[data-found]')).toBeNull();
    });
  });
});
