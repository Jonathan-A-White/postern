// features/steps/general-replies.steps.tsx — runs features/general-replies.feature
// (mw-hkg17.2): the Talk screen on General against a seeded Dexie, with sendToThread
// stood in for so what a reply sends can be read back.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const sendToThread = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: (...args: unknown[]) => sendToThread(...args),
}));

let sequence = 0;
let seeded: MessageRow[] = [];
const byText = new Map<string, MessageRow>();
const BASE = 1_760_000_000;

function say(text: string, options: { re?: string; thread?: string } = {}): MessageRow {
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  const row: MessageRow = {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: BASE + sequence * 60,
    ciphertext: '',
    plaintext: options.re === undefined ? text : JSON.stringify({ text, re: options.re }),
    direction: 'received',
    read: true,
    ...(options.thread !== undefined ? { thread: options.thread } : {}),
  };
  seeded.push(row);
  byText.set(text, row);
  return row;
}

async function fresh(): Promise<void> {
  cleanup();
  sequence = 0;
  seeded = [];
  byText.clear();
  sendToThread.mockReset();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk&t=general');
}

// A stand-in for App's routing: Talk on whatever thread and root the URL names.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
}

async function open(): Promise<void> {
  cleanup();
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  render(<Harness />);
}

/** The message texts in the conversation, top to bottom. */
function shown(): string[] {
  return within(screen.getByTestId('conversation'))
    .getAllByTestId('message')
    .map((bubble) => bubble.querySelector('p:not(.font-semibold)')?.textContent ?? bubble.textContent ?? '');
}

const generalShows = async (text: string) => {
  await waitFor(() => expect(within(screen.getByTestId('conversation')).getByText(text)).toBeInTheDocument());
};

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/general-replies.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const postWithReplies = (text: string, first: string, second: string) => {
    const root = say(text);
    say(first, { re: root.txid });
    say(second, { re: root.txid });
  };
  const postWithReply = (text: string, reply: string) => {
    const root = say(text);
    say(reply, { re: root.txid });
  };
  const generalOpens = open;
  const rowTapped = async (label: string) => {
    await userEvent.click(await screen.findByRole('link', { name: new RegExp(`^${label}`) }));
  };
  const threadShowsThree = async (a: string, b: string, c: string) => {
    await waitFor(() => expect(shown()).toEqual([a, b, c]));
  };
  const composerSays = async (placeholder: string) => {
    expect(await screen.findByPlaceholderText(placeholder)).toBeInTheDocument();
  };

  Scenario('mw-hkg17.2: General shows a post once with how many replies it has, and not the replies', ({ Given, When, Then, And }) => {
    Given('a General post {string} with the replies {string} and {string}', (_ctx, text: string, first: string, second: string) => postWithReplies(text, first, second));
    When('General opens', generalOpens);
    Then('{string} is shown once', async (_ctx, text: string) => {
      await generalShows(text);
      expect(screen.getAllByText(text)).toHaveLength(1);
    });
    And('its row says {string}', async (_ctx, label: string) => {
      expect(await screen.findByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    });
    And('{string} is not shown in General', (_ctx, text: string) => {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    });
  });

  Scenario('mw-hkg17.2: one reply reads as the singular', ({ Given, When, Then }) => {
    Given('a General post {string} with the reply {string}', (_ctx, text: string, reply: string) => postWithReply(text, reply));
    When('General opens', generalOpens);
    Then('its row says {string}', async (_ctx, label: string) => {
      expect(await screen.findByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    });
  });

  Scenario('mw-hkg17.2: tapping N replies opens the thread with the post at the top and the replies below in time order', ({ Given, When, Then, And }) => {
    Given('a General post {string} with the replies {string} and {string}', (_ctx, text: string, first: string, second: string) => postWithReplies(text, first, second));
    When('General opens', generalOpens);
    And('the {string} row is tapped', (_ctx, label: string) => rowTapped(label));
    Then('the thread shows {string}, {string} and {string} in that order', (_ctx, a: string, b: string, c: string) => threadShowsThree(a, b, c));
    And('the composer says {string}', (_ctx, placeholder: string) => composerSays(placeholder));
  });

  Scenario('mw-hkg17.2: Reply on a General post opens its thread', ({ Given, When, Then, And }) => {
    Given('a General post {string} with no replies', (_ctx, text: string) => {
      say(text);
    });
    When('General opens', generalOpens);
    And('Reply is tapped on {string}', async (_ctx, text: string) => {
      await generalShows(text);
      await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    });
    Then('the thread shows {string}', async (_ctx, text: string) => {
      await waitFor(() => expect(shown()).toEqual([text]));
    });
    And('the composer says {string}', (_ctx, placeholder: string) => composerSays(placeholder));
  });

  Scenario("mw-hkg17.2: sending from Reply… writes a message whose re is the post's txid, shown in the thread and not at General's top level", ({ Given, When, Then, And }) => {
    Given('a General post {string} with the reply {string}', (_ctx, text: string, reply: string) => postWithReply(text, reply));
    When('General opens', generalOpens);
    And('the {string} row is tapped', (_ctx, label: string) => rowTapped(label));
    And('{string} is sent from the Reply… composer', async (_ctx, text: string) => {
      const root = byText.get('the post')!;
      sendToThread.mockImplementation(async (_thread: unknown, body: string, _files: unknown, re?: string) => {
        const sent = say(body, { re });
        await messagesRepo.put({ ...sent, direction: 'sent' });
        return [{ txid: sent.txid, channel: 'direct' }];
      });
      expect(root).toBeDefined();
      await userEvent.type(await screen.findByPlaceholderText('Reply…'), text);
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    Then('the message was sent to General with re set to the txid of {string}', async (_ctx, text: string) => {
      await waitFor(() => expect(sendToThread).toHaveBeenCalledTimes(1));
      const [thread, body, files, re] = sendToThread.mock.calls[0] as [unknown, string, unknown[], string];
      expect(thread).toBeUndefined();
      expect(body).toBe('with a link');
      expect(files).toEqual([]);
      expect(re).toBe(byText.get(text)!.txid);
    });
    And('the thread shows {string}, {string} and {string} in that order', (_ctx, a: string, b: string, c: string) => threadShowsThree(a, b, c));
    When('Back is tapped', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    Then('General shows {string} once and its row says {string}', async (_ctx, text: string, label: string) => {
      await generalShows(text);
      expect(screen.getAllByText(text)).toHaveLength(1);
      expect(await screen.findByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    });
    And('{string} is not shown in General', (_ctx, text: string) => {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    });
  });

  Scenario('mw-hkg17.2: a bead thread renders as before', ({ Given, When, Then, And }) => {
    Given('a bead thread with the messages {string} and {string}', (_ctx, first: string, second: string) => {
      say(first, { thread: 'bead:mw-a.1' });
      say(second, { thread: 'bead:mw-a.1' });
      window.history.replaceState(null, '', '/?v=talk&t=bead%3Amw-a.1');
    });
    When('the bead thread opens', open);
    Then('the thread shows {string} and {string} in that order', async (_ctx, a: string, b: string) => {
      await waitFor(() => expect(shown()).toEqual([a, b]));
    });
    And('no replies row is shown', () => {
      expect(screen.queryByText(/\d+ repl(y|ies)/)).not.toBeInTheDocument();
    });
    And('the composer says {string}', (_ctx, placeholder: string) => composerSays(placeholder));
  });
});
