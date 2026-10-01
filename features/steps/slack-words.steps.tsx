// features/steps/slack-words.steps.tsx — runs features/slack-words.feature
// (mw-909ci.5, mw-6ww.51 Q2 and Q3): the words 'channel' and 'thread', no 'topic',
// no '#'. The whole app (<App />) against a small stubbed backend serving
// tests/support/cockpit-fixture.ts, at phone width (jsdom has no matchMedia).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, expect, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import { PrivateKey, Utils } from '@bsv/sdk';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { sharesRepo, vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { sealDocument } from '../../src/services/documents';
import { MAYOR, fixtureRecords, fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const feature = await loadFeature('features/slack-words.feature');

const HIM = PrivateKey.fromHex('5a'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const HIM_PUB = HIM.toPublicKey().toString();

/** The txid of the post in "desktop move" that the thread screen opens on (the last fixture record). */
let rootTxid = '';

afterAll(() => {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function factoryIsLive(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.answers.clear(), db.shares.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM_PUB });
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(fixtureView(now)), MAYOR.toHex(), HIM_PUB);
  const records = fixtureRecords(HIM, now);
  rootTxid = records[records.length - 1].txid;
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
}

/** Open the app at a URL and wait for the Talk list's rows (or the Share screen's region) to settle. */
async function openAt(search: string): Promise<void> {
  cleanup();
  window.history.pushState({}, '', `/${search}`);
  render(<App />);
}

async function openTalkList(): Promise<void> {
  await openAt('?v=talk');
  await screen.findByTestId('thread-list');
  await within(screen.getByTestId('thread-list')).findByText('desktop move');
}

async function openShare(): Promise<void> {
  await sharesRepo.put({ id: 's1', createdAt: Date.now(), files: [{ name: 'screen.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer }] });
  await openAt('?v=share&s=s1');
  await screen.findByRole('region', { name: 'Where to' });
}

const heading = () => screen.getByRole('heading', { level: 1 });

/** Every word a person can read or hear on screen: the text, plus labels, placeholders and titles. */
function visibleWords(): string {
  // Text node by text node, so words in neighbouring elements (a label and the line under it) stay apart.
  const parts: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
  for (const element of document.body.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
    for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value) parts.push(value);
    }
  }
  return parts.join('\n');
}

/** Each screen's reading plus the titles shown on it. */
const sweep: { screen: string; words: string; titles: string[] }[] = [];

async function record(name: string, ready: () => Promise<unknown>): Promise<void> {
  await ready();
  const rowTitles = Array.from(document.body.querySelectorAll('[data-testid="thread-list"] button span.truncate')).map((e) => e.textContent ?? '');
  sweep.push({ screen: name, words: visibleWords(), titles: [heading()?.textContent ?? '', ...rowTitles] });
}

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-6ww.51 Q2: the Talk list is titled Channels with New channel and Find a channel', ({ Given, When, Then, And }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('Talk is opened on the list', openTalkList);
    Then('the screen is titled {string} and says {string}', (_c, title: string, subtitle: string) => {
      expect(heading()).toHaveTextContent(new RegExp(`^${title}$`));
      expect(screen.getByText(subtitle)).toBeInTheDocument();
    });
    And('the list offers a {string} button and a {string} search box', (_c, button: string, search: string) => {
      expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: search })).toBeInTheDocument();
    });
  });

  Scenario('mw-6ww.51 Q2: the Share screen offers New channel', ({ Given, When, Then }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('a screenshot is shared and the Share screen is opened', openShare);
    Then('the first row of Where to says {string}', (_c, text: string) => {
      const rows = within(screen.getByRole('region', { name: 'Where to' })).getAllByRole('button');
      expect(rows[0]).toHaveTextContent(text);
    });
  });

  Scenario("mw-6ww.51 Q2: a named channel's subtitle reads Channel", ({ Given, When, Then }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('the channel {string} is opened', (_c, name: string) => openAt(`?v=talk&t=${encodeURIComponent(`topic:${name}`)}`));
    Then('the screen is titled {string} and its subtitle reads {string}', async (_c, title: string, subtitle: string) => {
      await waitFor(() => expect(heading()).toHaveTextContent(title));
      expect(heading().nextElementSibling).toHaveTextContent(new RegExp(`^${subtitle}$`));
    });
  });

  Scenario('mw-6ww.51 Q2: an open channel offers Archive channel', ({ Given, When, Then }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('the channel {string} is opened', (_c, name: string) => openAt(`?v=talk&t=${encodeURIComponent(`topic:${name}`)}`));
    Then('the screen offers {string}', async (_c, label: string) => {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  Scenario('mw-6ww.51 Q3: no screen shows topic or a # before a channel name', ({ Given, When, Then, And }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('the Talk list, a channel, a thread and the Share screen are each opened', async () => {
      sweep.length = 0;
      await record('the Talk list', openTalkList);
      await record('a channel', async () => {
        await openAt(`?v=talk&t=${encodeURIComponent('topic:desktop move')}`);
        await screen.findByText(/The runbook is in/);
      });
      await record('a thread', async () => {
        await openAt(`?v=talk&t=${encodeURIComponent('topic:desktop move')}&r=${encodeURIComponent(rootTxid)}`);
        await screen.findByText(/The runbook is in/);
        await screen.findByPlaceholderText('Reply…');
      });
      await record('the Share screen', openShare);
    });
    Then('none of them shows the word topic', () => {
      expect(sweep).toHaveLength(4);
      for (const { screen: name, words } of sweep) expect(words.match(/\btopic\b/i), `${name} shows 'topic'`).toBeNull();
    });
    And('no channel title starts with a hash mark', () => {
      for (const { screen: name, titles } of sweep) for (const title of titles) expect(title.trim().startsWith('#'), `${name}: '${title}' starts with #`).toBe(false);
    });
  });

  Scenario('mw-6ww.51: an old thread link still lands in that channel', ({ Given, When, Then }) => {
    Given('the factory is live with a channel named {string}', factoryIsLive);
    When('the old link {string} is opened', (_c, link: string) => openAt(link));
    Then('the channel of {string} is open with the title {string} and the Archive channel button', async (_c, _bead: string, title: string) => {
      await waitFor(() => expect(heading()).toHaveTextContent(title));
      expect(await screen.findByRole('button', { name: 'Archive channel' })).toBeInTheDocument();
    });
  });
});
