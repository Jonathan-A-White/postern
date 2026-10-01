// features/steps/share-thread.steps.tsx — runs features/share-thread.feature
// (mw-909ci.4): the Share screen's 'Threads' on a channel row, a post picked
// there, and the Reply... composer holding the shared files. The whole app
// (<App />) against a small stubbed backend serving tests/support/cockpit-fixture.ts;
// the upload and the delivery are doubles, the rest of the send is real.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { App } from '../../src/App';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, sharesRepo, vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { sealDocument } from '../../src/services/documents';
import { encodeThreadedMessage, threadKey, type ThreadedBody } from '../../src/services/threads';
import { MAYOR, fixtureRecords, fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const doubles = vi.hoisted(() => ({ delivered: [] as unknown[] }));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: (key: Uint8Array) => ({ key, mayorKey: '02'.padEnd(66, '0'), direct: true }),
}));
vi.mock('../../src/services/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/attachments')>()),
  uploadAttachment: async ({ bytes, mime }: { bytes: Uint8Array; mime: string }) => ({ hash: bytes[0].toString(16).padStart(2, '0').repeat(32), size: bytes.length + 100, mime }),
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: async (message: { thread?: Parameters<typeof threadKey>[0] }) => {
    doubles.delivered.push(message);
    const txid = `direct:${'e'.repeat(63)}${doubles.delivered.length}`;
    await messagesRepo.put({
      id: `${txid}:0`,
      txid,
      vout: 0,
      seq: 500 + doubles.delivered.length,
      class: 'message',
      to: '02'.padEnd(66, '0'),
      from: '03'.padEnd(66, '0'),
      ts: Math.floor(Date.now() / 1000),
      ciphertext: '',
      plaintext: encodeThreadedMessage(message as ThreadedBody),
      direction: 'sent',
      read: true,
      ...(message.thread !== undefined ? { thread: threadKey(message.thread) } : {}),
    });
    return { txid, channel: 'direct' };
  },
}));
vi.mock('../../src/services/blobs', () => ({ openAttachment: async () => 'blob:image' }));

const feature = await loadFeature('features/share-thread.feature');

const HIM = PrivateKey.fromHex('5a'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const HIM_PUB = HIM.toPublicKey().toString();
const BEAD = 'mw-f758y.30.2';
const NAMES = ['post one', 'post two', 'post three', 'post four', 'post five', 'post six'];

const seeded = new Map<string, MessageRow>();
let sequence = 0;

afterAll(() => {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function park(id: string): Promise<void> {
  await sharesRepo.put({
    id,
    createdAt: Date.now(),
    files: [
      { name: 'first.png', type: 'image/png', bytes: new Uint8Array([1, 80, 78, 71]).buffer },
      { name: 'second.png', type: 'image/png', bytes: new Uint8Array([2, 80, 78, 71]).buffer },
    ],
  });
}

async function liveWithTwoScreenshots(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  seeded.clear();
  sequence = 0;
  doubles.delivered = [];
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.answers.clear(), db.shares.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM_PUB });
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(fixtureView(now)), MAYOR.toHex(), HIM_PUB);
  const records = fixtureRecords(HIM, now);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/challenge')) return json({ nonce: crypto.randomUUID().replace(/-/g, '') });
      if (path.endsWith('/me')) return json({ pubkey: HIM_PUB, mayor: MAYOR.toPublicKey().toString(), network: 'testnet', features: ['direct', 'view', 'beads', 'me'] });
      if (path.endsWith('/view')) return new Response(view, { status: 200, headers: { ETag: '"fixture"' } });
      if (path.endsWith('/messages')) return json({ records, next: records.length });
      return new Response('not found', { status: 404 });
    }),
  );
  setKey(HIM_KEY);
  await park('s1');
}

/** A received message in a channel, `minutesAgo` old; the Mayor's words, or a reply when `re` is given. */
async function say(text: string, minutesAgo: number, channel: string | undefined, re?: string, files?: ThreadedBody['attachments']): Promise<MessageRow> {
  sequence += 1;
  const txid = `direct:${'a'.repeat(60)}${String(sequence).padStart(4, '0')}`;
  const row: MessageRow = {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 100 + sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(Date.now() / 1000) - minutesAgo * 60,
    ciphertext: '',
    plaintext: encodeThreadedMessage({ text, ...(re !== undefined ? { re } : {}), ...(files ? { attachments: files } : {}) }),
    direction: 'received',
    read: true,
    ...(channel !== undefined ? { thread: channel } : {}),
  };
  await messagesRepo.put(row);
  seeded.set(text, row);
  return row;
}

async function openShare(id: string): Promise<void> {
  cleanup();
  window.history.pushState({}, '', `/?v=share&s=${id}`);
  render(<App />);
  await screen.findByRole('region', { name: 'Where to' });
}

const whereTo = () => screen.getByRole('region', { name: 'Where to' });
const postsUnder = (channel: string) => within(whereTo()).queryByRole('list', { name: `Posts in ${channel}` });

async function threadsTapped(label: string): Promise<void> {
  await userEvent.click(await within(whereTo()).findByRole('button', { name: label }));
}

async function postTapped(text: string): Promise<void> {
  await userEvent.click(await within(whereTo()).findByRole('button', { name: new RegExp(text) }));
}

async function composerHoldsBoth(): Promise<void> {
  const composer = await screen.findByTestId('composer');
  expect(await within(composer).findByRole('button', { name: 'Remove first.png' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: 'Remove second.png' })).toBeInTheDocument();
}

function rowTitles(): string[] {
  return within(whereTo())
    .getAllByRole('button')
    .map((row) => row.textContent ?? '');
}

const factoryPosts = async () => {
  const roots: MessageRow[] = [];
  for (const [i, name] of NAMES.entries()) roots.push(await say(name, 10 - i, undefined));
  const five = roots[4];
  await say('first answer', 3, undefined, five.txid);
  await say('second answer', 2, undefined, five.txid);
};

describeFeature(feature, ({ Scenario }) => {
  const live = () => liveWithTwoScreenshots();
  const factoryHasPosts = factoryPosts;
  const beadHasPost = async (_ctx: unknown, text: string) => {
    await say(text, 1, `bead:${BEAD}`);
  };
  const shareOpenedThreads = async (_ctx: unknown, label: string) => {
    await openShare('s1');
    await threadsTapped(label);
  };
  const shareOpenedThreadsPost = async (_ctx: unknown, label: string, post: string) => {
    await shareOpenedThreads(undefined, label);
    await postTapped(post);
  };
  const threadOpens = async (_ctx: unknown, text: string, prefix: string) => {
    await waitFor(() => expect(window.location.search).toBe(`${prefix}${encodeURIComponent(seeded.get(text)!.txid)}`));
  };
  const sendTapped = async () => {
    await composerHoldsBoth();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  };
  const oneDelivered = async (_ctx: unknown, text: string) => {
    await waitFor(() => expect(doubles.delivered).toHaveLength(1));
    const message = doubles.delivered[0] as { re?: string; text: string; attachments?: { hash: string }[]; attachment?: unknown };
    expect(message.re).toBe(seeded.get(text)!.txid);
    expect(message.attachments?.map((file) => file.hash)).toEqual(['01'.repeat(32), '02'.repeat(32)]);
    expect(message.attachment).toBeUndefined();
  };

  Scenario('mw-6ww.51: Threads on Factory lists its 5 newest posts with their reply counts', ({ Given, And, When, Then }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    And('the Factory has the posts {string} to {string}, and {string} has 2 replies', factoryHasPosts);
    When('the Share screen is opened and {string} is tapped', shareOpenedThreads);
    Then('under Factory come {string}, {string}, {string}, {string} and {string} in that order', async (_ctx, ...names: string[]) => {
      const list = await within(whereTo()).findByRole('list', { name: 'Posts in Factory' });
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(5);
      names.forEach((name, i) => expect(items[i].textContent).toContain(name));
    });
    And('{string} says {string} and {string} says no replies', (_ctx, withReplies: string, label: string, without: string) => {
      const list = postsUnder('Factory')!;
      const item = (name: string) => within(list).getAllByRole('listitem').find((li) => li.textContent?.includes(name))!;
      expect(item(withReplies).textContent).toContain(label);
      expect(item(without).textContent).not.toMatch(/repl(y|ies)/);
    });
    When('{string} is tapped again', async (_ctx, label: string) => {
      await threadsTapped(label);
    });
    Then('no posts are listed under Factory', () => {
      expect(postsUnder('Factory')).toBeNull();
    });
  });

  Scenario('mw-6ww.51: picking a post opens its Thread with both shared images in the Reply... composer, and the parked share is gone', ({ Given, And, When, Then }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    And('the Factory has the posts {string} to {string}, and {string} has 2 replies', factoryHasPosts);
    When('the Share screen is opened and {string} is tapped and the post {string} is tapped', shareOpenedThreadsPost);
    Then('the Thread of {string} opens at {string} followed by its txid', threadOpens);
    And('the Reply... composer holds both screenshots', async () => {
      await composerHoldsBoth();
      expect(screen.getByPlaceholderText('Reply…')).toBeInTheDocument();
    });
    And('the parked share is gone', async () => {
      await waitFor(async () => expect(await db.shares.count()).toBe(0));
    });
  });

  Scenario('mw-6ww.51: sending from there writes ONE message with re = the post\'s txid and both files in attachments, shown as one reply in the thread and counted in N replies', ({ Given, And, When, Then }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    And('the Factory has the posts {string} to {string}, and {string} has 2 replies', factoryHasPosts);
    When('the Share screen is opened and {string} is tapped and the post {string} is tapped', shareOpenedThreadsPost);
    And('Send is tapped in the Reply... composer', sendTapped);
    Then('one message was delivered, with re set to the txid of {string} and both files in attachments', oneDelivered);
    And('the Thread shows {string}, its 2 replies and one reply holding two images', async (_ctx, post: string) => {
      const conversation = await screen.findByTestId('conversation');
      await waitFor(() => expect(within(conversation).getAllByTestId('message')).toHaveLength(4));
      const bubbles = within(conversation).getAllByTestId('message');
      expect(bubbles[0].textContent).toContain(post);
      expect(await within(bubbles[3]).findAllByAltText('Attached image')).toHaveLength(2);
    });
    When('Back is tapped', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    Then('the Factory shows {string} once and its row says {string}', async (_ctx, post: string, label: string) => {
      expect(await screen.findByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      expect(screen.getAllByText(post)).toHaveLength(1);
    });
  });

  Scenario("mw-6ww.51: the same in a bead's channel", ({ Given, And, When, Then }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    And('the bead channel of {string} has the post {string}', (_ctx, _bead: string, text: string) => beadHasPost(undefined, text));
    When('the Share screen is opened and {string} is tapped and the post {string} is tapped', shareOpenedThreadsPost);
    Then('the Thread of {string} opens at {string} followed by its txid', threadOpens);
    And('the Reply... composer holds both screenshots', composerHoldsBoth);
    When('Send is tapped in the Reply... composer', sendTapped);
    Then('one message was delivered, with re set to the txid of {string} and both files in attachments', oneDelivered);
  });

  Scenario('mw-6ww.51: tapping the channel row itself still opens the channel with the files', ({ Given, When, Then, And }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    When('the Share screen is opened and the {string} row is tapped', async (_ctx, row: string) => {
      await openShare('s1');
      await userEvent.click(await within(whereTo()).findByRole('button', { name: new RegExp(`^${row}`) }));
    });
    Then('the channel opens at {string}', async (_ctx, search: string) => {
      await waitFor(() => expect(window.location.search).toBe(search));
    });
    And('the composer holds both screenshots', composerHoldsBoth);
  });

  Scenario('mw-6ww.51: choosing a thread remembers its channel as Last used', ({ Given, And, When, Then }) => {
    Given('the factory is live and two screenshots were shared into Postern', live);
    And('the bead channel of {string} has the post {string}', (_ctx, _bead: string, text: string) => beadHasPost(undefined, text));
    When('the Share screen is opened and {string} is tapped and the post {string} is tapped', shareOpenedThreadsPost);
    And('two screenshots are shared into Postern again and the Share screen is opened', async () => {
      await composerHoldsBoth();
      await park('s2');
      await openShare('s2');
    });
    Then('the first row says {string} and the second is {string} marked {string}', async (_ctx, first: string, second: string, mark: string) => {
      await waitFor(() => {
        const rows = rowTitles();
        expect(rows[0]).toContain(first);
        expect(rows[1]).toContain(second);
        expect(rows[1]).toContain(mark);
      });
    });
  });
});
