// features/steps/verified-under-how-to.steps.tsx — runs features/verified-under-how-to.feature (mw-581qad.2):
// the story's channel shows the Verified button under the newest post carrying HOW TO CHECK IT.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within, fireEvent, act, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { deliverThreaded } from '../../src/services/deliver';
import { fixtureDetail, fixtureView } from '../../tests/support/cockpit-fixture';
import type { BeadComment } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: vi.fn(async () => ({ txid: 'direct:aa', channel: 'direct' })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const VERIFY_BEAD = 'mw-gq6.130';
const PLAIN_BEAD = 'mw-f758y.31.2';
const BUILDER_COMMENT = 'Done and verified by test.\n\nHOW TO CHECK IT, for the Governor:\n1. Open the Me place';
const MAYOR_POST = 'It has landed. HOW TO CHECK IT\n1. Open the Me place\n\nType VERIFIED here when it looks right.';

let bead = VERIFY_BEAD;

async function seed(id: string, comments: BeadComment[]): Promise<void> {
  bead = id;
  const now = Date.now();
  const view = fixtureView(now);
  view.written_at = new Date(now - 60_000).toISOString();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: now });
  const detail = fixtureDetail(id, now);
  if (!detail) throw new Error('fixture bead missing');
  detail.comments = comments;
  await beadDetailsRepo.save({ id, plaintext: JSON.stringify(detail), fetchedAt: now });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const bothPosts = (): BeadComment[] => [
  { at: minutesAgo(50), author: 'builder@laptop', text: BUILDER_COMMENT },
  { at: minutesAgo(40), author: 'root', text: MAYOR_POST },
];

afterAll(() => cleanup());

const feature = await loadFeature('features/verified-under-how-to.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    forgetOutboxState();
    vi.mocked(deliverThreaded).mockClear();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
  });
  AfterEachScenario(() => {
    cleanup();
    forgetOutboxState();
  });

  const bothPostsGiven = () => seed(VERIFY_BEAD, bothPosts());
  const opens = () => {
    render(<BeadScreen id={bead} />);
  };
  const underHowTo = () => screen.queryAllByTestId('verified-under-how-to');

  Scenario('mw-581qad.2: the button sits under the newest post carrying HOW TO CHECK IT', ({ Given, When, Then }) => {
    Given('a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT', bothPostsGiven);
    When('he opens the bead page', opens);
    Then("exactly one Verified button sits in the conversation, under the Mayor's post", async () => {
      await waitFor(() => expect(underHowTo()).toHaveLength(1));
      const [slot] = underHowTo();
      expect(within(slot).getAllByRole('button', { name: 'Verified' })).toHaveLength(1);
      expect(slot.parentElement).toHaveTextContent('It has landed.');
      expect(slot.parentElement).not.toHaveTextContent('Done and verified by test.');
    });
  });

  Scenario('mw-581qad.2: a story with no verify need has no button in the conversation', ({ Given, When, Then }) => {
    Given('a story with no verify need whose channel holds a post carrying HOW TO CHECK IT', () => seed(PLAIN_BEAD, bothPosts()));
    When('he opens the bead page', opens);
    Then('no Verified button sits in the conversation', async () => {
      await screen.findByText(/It has landed\./);
      expect(underHowTo()).toHaveLength(0);
    });
  });

  Scenario('mw-581qad.2: a verify need and no post carrying the marker leaves only the Actions row', ({ Given, When, Then, And }) => {
    Given('a landed story with a verify need whose channel holds no post carrying HOW TO CHECK IT', () =>
      seed(VERIFY_BEAD, [{ at: minutesAgo(40), author: 'root', text: 'It has landed. Type VERIFIED when it looks right.' }]),
    );
    When('he opens the bead page', opens);
    Then('no Verified button sits in the conversation', async () => {
      await screen.findByText(/It has landed\./);
      expect(underHowTo()).toHaveLength(0);
    });
    And('the Actions row still offers Verified', async () => {
      const actions = await screen.findByLabelText('Actions');
      expect(within(actions).getByRole('button', { name: 'Verified' })).toBeEnabled();
    });
  });

  Scenario("mw-581qad.2: tapping Yes, verified under the post sends one message and kills the Actions row's button", ({ Given, When, And, Then }) => {
    Given('a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT', bothPostsGiven);
    When('he opens the bead page', opens);
    And("he taps Verified under the Mayor's post and then Yes, verified", async () => {
      await waitFor(() => expect(underHowTo()).toHaveLength(1));
      fireEvent.click(within(underHowTo()[0]).getByRole('button', { name: 'Verified' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, verified' }));
    });
    Then('one message to the channel of that bead says {string}', async (_c, words: string) => {
      await waitFor(() => expect(deliverThreaded).toHaveBeenCalledTimes(1));
      await act(async () => settledOutbox());
      expect(deliverThreaded).toHaveBeenCalledTimes(1);
      expect(deliverThreaded).toHaveBeenCalledWith(expect.objectContaining({ thread: { bead: VERIFY_BEAD }, text: words }), expect.anything());
    });
    And('no Verified button is left on the page', async () => {
      await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Verified' })).toHaveLength(0));
      expect(screen.queryByRole('button', { name: 'Yes, verified' })).toBeNull();
    });
  });

  Scenario('mw-581qad.2: once the story is verified the button under the post is gone', ({ Given, And, When, Then }) => {
    Given('a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT', bothPostsGiven);
    And('he has already answered that verify need', async () => {
      await db.answers.put({ bead: VERIFY_BEAD, answer: 'verified', txid: 'direct:aa', ts: Math.floor(Date.now() / 1000) });
    });
    When('he opens the bead page', opens);
    Then('no Verified button sits in the conversation', async () => {
      await screen.findByText(/It has landed\./);
      expect(underHowTo()).toHaveLength(0);
    });
  });
});
