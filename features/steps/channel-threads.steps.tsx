// features/steps/channel-threads.steps.tsx — runs features/channel-threads.feature
// (mw-909ci.2): reply threads in a bead's and a named channel, on the Talk screen and
// the bead page, against a seeded Dexie, with sendToThread stood in for so what a
// reply sends can be read back. A notification tap is resolved with the service
// worker's own resolveTapUrl and the URL it gives opened in the same harness.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { useRoute } from '../../src/router';
import { parseRoute } from '../../src/nav/route';
import { resolveTapUrl } from '../../src/push/tapTarget';
import { threadKey, type ThreadRef } from '../../src/services/threads';
import { db, type MessageRow } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const sendToThread = vi.fn();
vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:image' }));
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendToThread: (...args: unknown[]) => sendToThread(...args),
}));

let sequence = 0;
let seeded: MessageRow[] = [];
let comments: { author: string; at: string; text: string }[] = [];
let detailFor: string | undefined;
const byText = new Map<string, MessageRow>();
const BASE = 1_760_000_000;

function say(text: string, options: { re?: string; thread?: string; direction?: 'sent' | 'received'; role?: string; cls?: MessageRow['class']; files?: { hash: string; size: number; mime: string }[] } = {}): MessageRow {
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  const row: MessageRow = {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: options.cls ?? 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: BASE + sequence * 60,
    ciphertext: '',
    plaintext:
      options.re === undefined && options.files === undefined
        ? text
        : JSON.stringify({ text, ...(options.files?.length === 1 ? { attachment: options.files[0] } : {}), ...(options.files && options.files.length > 1 ? { attachments: options.files } : {}), ...(options.re !== undefined ? { re: options.re } : {}), ...(options.role !== undefined ? { role: options.role } : {}) }),
    direction: options.direction ?? 'received',
    read: true,
    ...(options.thread !== undefined ? { thread: options.thread } : {}),
  };
  seeded.push(row);
  byText.set(text, row);
  return row;
}

const beadChannel = (id: string) => `bead:${id}`;
const namedChannel = (name: string) => `topic:${name}`;

async function fresh(): Promise<void> {
  cleanup();
  sequence = 0;
  seeded = [];
  comments = [];
  detailFor = undefined;
  byText.clear();
  sendToThread.mockReset();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

// A stand-in for App's routing: the bead page or Talk on whatever the URL names.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  if (route.view === 'bead') return <BeadScreen id={route.id} />;
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
}

async function open(url: string): Promise<void> {
  cleanup();
  window.history.replaceState(null, '', url);
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  if (detailFor) {
    const bead = fixtureView(now).beads.find((candidate) => candidate.id === detailFor) ?? { id: detailFor };
    await beadDetailsRepo.save({ id: detailFor, plaintext: JSON.stringify({ ...bead, comments }), fetchedAt: now });
  }
  render(<Harness />);
}

const talkUrl = (key: string) => `/?v=talk&t=${encodeURIComponent(key)}`;

/** The message texts in the conversation, top to bottom. */
function shown(): string[] {
  return within(screen.getByTestId('conversation'))
    .getAllByTestId('message')
    .map((bubble) => bubble.querySelector('p:not(.font-semibold)')?.textContent ?? bubble.textContent ?? '');
}

const conversationShows = async (text: string) => {
  await waitFor(() => expect(within(screen.getByTestId('conversation')).getByText(text)).toBeInTheDocument());
};
const repliesRow = (label: string) => screen.findByRole('link', { name: new RegExp(`^${label}`) });

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/channel-threads.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const postWithReplies = (channel: string, text: string, ...replies: string[]) => {
    const root = say(text, { thread: channel });
    for (const reply of replies) say(reply, { re: root.txid, thread: channel });
  };
  const postWithTwo = (_ctx: unknown, text: string, bead: string, first: string, second: string) => postWithReplies(beadChannel(bead), text, first, second);
  const shownOnce = async (_ctx: unknown, text: string) => {
    await conversationShows(text);
    expect(screen.getAllByText(text)).toHaveLength(1);
  };
  const rowSays = async (_ctx: unknown, label: string) => {
    expect(await repliesRow(label)).toBeInTheDocument();
  };
  const notShown = (_ctx: unknown, text: string) => {
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  };
  const rowTapped = async (_ctx: unknown, label: string) => {
    await userEvent.click(await repliesRow(label));
  };
  const threadShows = async (...texts: string[]) => {
    await waitFor(() => expect(shown()).toEqual(texts));
  };
  const composerSays = async (_ctx: unknown, placeholder: string) => {
    expect(await screen.findByPlaceholderText(placeholder)).toBeInTheDocument();
  };
  const backTapped = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  };
  const showsOnceWithRow = async (_ctx: unknown, _channel: string, text: string, label: string) => {
    await shownOnce(undefined, text);
    expect(await repliesRow(label)).toBeInTheDocument();
  };

  Scenario('mw-6ww.51 Q1: a bead channel shows a post once with 2 replies, not the replies', ({ Given, When, Then, And }) => {
    Given('a post {string} in the channel of bead {string} with the replies {string} and {string}', (_ctx, text: string, bead: string, first: string, second: string) =>
      postWithTwo(_ctx, text, bead, first, second),
    );
    When('the channel of bead {string} opens', (_ctx, bead: string) => open(talkUrl(beadChannel(bead))));
    Then('{string} is shown once', shownOnce);
    And('its row says {string}', rowSays);
    And('{string} is not shown in the channel', notShown);
  });

  Scenario("mw-6ww.51 Q1: a named channel's post shows 1 reply", ({ Given, When, Then, And }) => {
    Given('a post {string} in the named channel {string} with the reply {string}', (_ctx, text: string, name: string, reply: string) => postWithReplies(namedChannel(name), text, reply));
    When('the named channel {string} opens', (_ctx, name: string) => open(talkUrl(namedChannel(name))));
    Then('its row says {string}', rowSays);
    And('{string} is not shown in the channel', notShown);
  });

  Scenario('mw-6ww.51 Q1: tapping N replies in a bead channel opens Thread with the post first and its replies in time order, Back returns to the bead channel', ({ Given, When, Then, And }) => {
    Given('a post {string} in the channel of bead {string} with the replies {string} and {string}', (_ctx, text: string, bead: string, first: string, second: string) =>
      postWithTwo(_ctx, text, bead, first, second),
    );
    When('the channel of bead {string} opens', (_ctx, bead: string) => open(talkUrl(beadChannel(bead))));
    And('the {string} row is tapped', rowTapped);
    Then('the screen is titled {string} and says {string}', async (_ctx, title: string, subtitle: string) => {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(subtitle)).toBeInTheDocument();
    });
    And('the thread shows {string}, {string} and {string} in that order', (_ctx, a: string, b: string, c: string) => threadShows(a, b, c));
    And('the composer says {string}', composerSays);
    When('Back is tapped', backTapped);
    Then('the channel of bead {string} shows {string} once and its row says {string}', (_ctx, _bead: string, text: string, label: string) => showsOnceWithRow(_ctx, _bead, text, label));
  });

  Scenario("mw-6ww.51 Q1: Reply... in a named channel sends a message whose thread is that channel and whose re is the post's txid, and it shows in the thread, not at the top level", ({ Given, When, Then, And }) => {
    Given('a post {string} in the named channel {string} with the reply {string}', (_ctx, text: string, name: string, reply: string) => postWithReplies(namedChannel(name), text, reply));
    When('the named channel {string} opens', (_ctx, name: string) => open(talkUrl(namedChannel(name))));
    And('the {string} row is tapped', rowTapped);
    And('{string} is sent from the Reply… composer', async (_ctx, text: string) => {
      sendToThread.mockImplementation(async (thread: ThreadRef | undefined, body: string, _files: unknown, re?: string) => {
        const sent = say(body, { re, thread: threadKey(thread), direction: 'sent' });
        await messagesRepo.put(sent);
        return [{ txid: sent.txid, channel: 'direct' }];
      });
      await userEvent.type(await screen.findByPlaceholderText('Reply…'), text);
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    Then('the message was sent to the channel {string} with re set to the txid of {string}', async (_ctx, key: string, text: string) => {
      await waitFor(() => expect(sendToThread).toHaveBeenCalledTimes(1));
      const [thread, body, files, re] = sendToThread.mock.calls[0] as [ThreadRef, string, unknown[], string];
      expect(threadKey(thread)).toBe(key);
      expect(body).toBe('with a link');
      expect(files).toEqual([]);
      expect(re).toBe(byText.get(text)!.txid);
    });
    And('the thread shows {string}, {string} and {string} in that order', (_ctx, a: string, b: string, c: string) => threadShows(a, b, c));
    When('Back is tapped', backTapped);
    Then('the named channel {string} shows {string} once and its row says {string}', (_ctx, _name: string, text: string, label: string) => showsOnceWithRow(_ctx, _name, text, label));
    And('{string} is not shown in the channel', notShown);
  });

  Scenario('mw-6ww.51 Q1: a bead comment stays a post', ({ Given, When, Then, And }) => {
    Given(
      "the channel of bead {string} holds the Builder's comment {string}, a post {string} with the reply {string} and a message {string} answering a message that is not here",
      (_ctx, bead: string, note: string, post: string, reply: string, orphan: string) => {
        comments = [{ author: 'builder', at: new Date((BASE - 3600) * 1000).toISOString(), text: note }];
        detailFor = bead;
        postWithReplies(beadChannel(bead), post, reply);
        say(orphan, { re: `direct:${'f'.repeat(64)}`, thread: beadChannel(bead) });
      },
    );
    When('the channel of bead {string} opens', (_ctx, bead: string) => open(talkUrl(beadChannel(bead))));
    Then('{string}, {string} and {string} are shown as posts in that order', async (_ctx, a: string, b: string, c: string) => {
      await threadShows(a, b, c);
    });
    And('{string} is the only one with a replies row', async (_ctx, text: string) => {
      const rows = await screen.findAllByRole('link', { name: /repl(y|ies)/ });
      expect(rows).toHaveLength(1);
      expect(rows[0].closest('[data-testid="conversation"] > div')?.textContent).toContain(text);
    });
  });

  Scenario('mw-6ww.51 Q1: the bead page shows the post once with 1 reply linking to the thread, and Reply there opens it', ({ Given, When, Then, And }) => {
    Given('a post {string} in the channel of bead {string} with the reply {string}', (_ctx, text: string, bead: string, reply: string) => postWithReplies(beadChannel(bead), text, reply));
    When('the page of bead {string} opens', (_ctx, bead: string) => open(`/?v=bead&id=${bead}`));
    Then('{string} is shown once', shownOnce);
    And('its row says {string} and links to the thread of {string} in that channel', async (_ctx, label: string, text: string) => {
      const link = await repliesRow(label);
      expect(link.getAttribute('href')).toBe(`?v=talk&t=bead%3Amw-f758y.30.2&r=${encodeURIComponent(byText.get(text)!.txid)}`);
    });
    And('{string} is not shown in the channel', notShown);
    When('Reply is tapped on {string}', async (_ctx, text: string) => {
      await conversationShows(text);
      await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    });
    Then('the thread shows {string} and {string} in that order', async (_ctx, a: string, b: string) => {
      await threadShows(a, b);
    });
  });

  Scenario("mw-6ww.51 Q1: a notification for a reply in a bead channel opens that post's thread", ({ Given, When, Then }) => {
    let tapped = '';
    Given('a post {string} in the channel of bead {string} with the reply {string}', (_ctx, text: string, bead: string, reply: string) => postWithReplies(beadChannel(bead), text, reply));
    When('the notification for the reply {string} is tapped', async (_ctx, reply: string) => {
      for (const row of seeded) await messagesRepo.put(row);
      tapped = await resolveTapUrl({ txid: byText.get(reply)!.txid, class: 'message' });
    });
    Then('the app opens the thread of {string} in the channel of bead {string}', (_ctx, text: string, bead: string) => {
      expect(parseRoute(new URL(tapped, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: beadChannel(bead), root: byText.get(text)!.txid });
    });
  });

  Scenario('mw-f758y.29: a notification for an alarm sent as a reply into a thread opens that thread', ({ Given, When, Then }) => {
    let tapped = '';
    Given('a post {string} in Factory with the alarm {string} sent as a reply to it', (_ctx, text: string, alarm: string) => {
      const root = say(text);
      say(alarm, { re: root.txid, cls: 'alarm' });
    });
    When('the notification for the alarm {string} is tapped', async (_ctx, alarm: string) => {
      for (const row of seeded) await messagesRepo.put(row);
      tapped = await resolveTapUrl({ txid: byText.get(alarm)!.txid, class: 'alarm' });
    });
    Then('the app opens the thread of {string} in Factory', (_ctx, text: string) => {
      expect(parseRoute(new URL(tapped, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: 'general', root: byText.get(text)!.txid });
    });
  });

  const postWithFactoryReply = (channel: string, text: string, reply: string) => {
    const root = say(text, { thread: channel });
    say(reply, { re: root.txid });
  };
  const subtitleSays = async (_ctx: unknown, title: string, subtitle: string) => {
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(subtitle)).toBeInTheDocument());
  };

  Scenario("mw-gq6.170 Q1: a reply sent with no channel to a post in a bead's channel shows under that post in the post's channel", ({ Given, When, Then, And }) => {
    let tapped = '';
    Given('a post {string} in the channel of bead {string} with the reply {string} sent in Factory', (_ctx, text: string, bead: string, reply: string) => postWithFactoryReply(beadChannel(bead), text, reply));
    When('the notification for the reply {string} is tapped', async (_ctx, reply: string) => {
      for (const row of seeded) await messagesRepo.put(row);
      tapped = await resolveTapUrl({ txid: byText.get(reply)!.txid, class: 'message' });
    });
    Then('the app opens the thread of {string} in the channel of bead {string}', (_ctx, text: string, bead: string) => {
      expect(parseRoute(new URL(tapped, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: beadChannel(bead), root: byText.get(text)!.txid });
    });
    When('that thread opens', () => open(tapped));
    Then('the screen is titled {string} and says {string}', subtitleSays);
    And('the thread shows {string} and {string} in that order', (_ctx, a: string, b: string) => threadShows(a, b));
    And('the composer says {string}', composerSays);
  });

  Scenario('mw-gq6.170 Q2: the same for a named channel', ({ Given, When, Then, And }) => {
    let tapped = '';
    Given('a post {string} in the named channel {string} with the reply {string} sent in Factory', (_ctx, text: string, name: string, reply: string) => postWithFactoryReply(namedChannel(name), text, reply));
    When('the notification for the reply {string} is tapped', async (_ctx, reply: string) => {
      for (const row of seeded) await messagesRepo.put(row);
      tapped = await resolveTapUrl({ txid: byText.get(reply)!.txid, class: 'message' });
    });
    Then('the app opens the thread of {string} in the named channel {string}', (_ctx, text: string, name: string) => {
      expect(parseRoute(new URL(tapped, 'https://postern.allmymind.org').search)).toEqual({ view: 'talk', thread: namedChannel(name), root: byText.get(text)!.txid });
    });
    When('that thread opens', () => open(tapped));
    Then('the screen is titled {string} and says {string}', subtitleSays);
    And('the thread shows {string} and {string} in that order', (_ctx, a: string, b: string) => threadShows(a, b));
  });

  Scenario('mw-gq6.170 Q3: a Thread link that names a post by Factory but the post lives in a bead\'s channel still opens that post with its reply', ({ Given, When, Then, And }) => {
    Given('a post {string} in the channel of bead {string} with the reply {string} sent in Factory', (_ctx, text: string, bead: string, reply: string) => postWithFactoryReply(beadChannel(bead), text, reply));
    When('the Factory thread of {string} opens', (_ctx, text: string) => open(`/?v=talk&t=general&r=${encodeURIComponent(byText.get(text)!.txid)}`));
    Then('the screen is titled {string} and says {string}', subtitleSays);
    And('the thread shows {string} and {string} in that order', (_ctx, a: string, b: string) => threadShows(a, b));
  });

  Scenario('mw-gq6.170 Q4: a Thread link to a post that is not on the phone keeps the empty state', ({ Given, When, Then }) => {
    Given('a reply {string} in Factory that names a post not on the phone', (_ctx, reply: string) => {
      say(reply, { re: `direct:${'f'.repeat(64)}` });
    });
    When('the Factory thread of a post that is not on the phone opens', () => open(`/?v=talk&t=general&r=${encodeURIComponent(`direct:${'f'.repeat(64)}`)}`));
    Then('the thread says {string}', async (_ctx, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  Scenario("mw-909ci.4: a picture with re is a reply in the post's thread and a transcript is not", ({ Given, When, Then, And }) => {
    Given('a post {string} in the named channel {string} with the picture reply {string} and the transcript {string}', (_ctx, text: string, name: string, picture: string, transcript: string) => {
      const root = say(text, { thread: namedChannel(name) });
      say(picture, { re: root.txid, thread: namedChannel(name), files: [{ hash: 'ab'.repeat(32), size: 90, mime: 'image/png' }] });
      say(transcript, { re: root.txid, thread: namedChannel(name), role: 'transcript' });
    });
    When('the named channel {string} opens', (_ctx, name: string) => open(talkUrl(namedChannel(name))));
    Then('its row says {string}', rowSays);
    And('{string} is not shown in the channel', notShown);
    When('the {string} row is tapped', rowTapped);
    Then('the thread shows {string} and {string} in that order', async (_ctx, a: string, b: string) => {
      await threadShows(a, b);
    });
  });
});
