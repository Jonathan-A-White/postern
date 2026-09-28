// features/steps/cockpit.steps.tsx — runs features/cockpit.feature: the whole
// app (<App />) against a stubbed v2 backend (docs/protocol.md §9–§15) serving
// tests/support/cockpit-fixture.ts, with his key already unlocked for the day.
// Every POST /api/messages is decrypted with the Mayor's key so a scenario can
// say exactly what reached him.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LockingScript, PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { sharesRepo, vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stopLive } from '../../src/services/live';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import { sealDocument } from '../../src/services/documents';
import { MAYOR, fixtureDetail, fixtureRecords, fixtureView } from '../../tests/support/cockpit-fixture';
import { approvalMessage, stepSha256 } from '../../src/model/hands';

// The whole app syncs messages, the view and a bead's detail before a scenario's
// words appear; on a loaded host that can take longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 });

const HIM = PrivateKey.fromHex('5a'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const HIM_PUB = HIM.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();

let delivered: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function stubBackend(): Promise<void> {
  const now = Date.now();
  const view = await sealDocument(JSON.stringify(fixtureView(now)), MAYOR.toHex(), HIM_PUB);
  const records = fixtureRecords(HIM, now);
  const details = new Map<string, string>();
  for (const id of ['mw-f758y.30.2', 'mw-2rbm.10']) details.set(id, await sealDocument(JSON.stringify(fixtureDetail(id, now)), MAYOR.toHex(), HIM_PUB));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path.endsWith('/challenge')) return json({ nonce: crypto.randomUUID().replace(/-/g, '') });
      if (path.endsWith('/me')) return json({ pubkey: HIM_PUB, mayor: MAYOR_PUB, network: 'testnet', features: ['direct', 'view', 'beads', 'me'] });
      if (path.endsWith('/view')) return new Response(view, { status: 200, headers: { ETag: '"fixture"' } });
      if (path.endsWith('/messages') && init?.method === 'POST') {
        const { scriptHex } = JSON.parse(String(init.body)) as { scriptHex: string };
        const decoded = decodeRecordScript(LockingScript.fromHex(scriptHex))!;
        const payload = JSON.parse(Utils.toUTF8(Array.from(decoded.payloadBytes))) as MessagePayload;
        delivered.push(decryptMessage(payload, MAYOR.toHex()));
        return json({ txid: `direct:${String(delivered.length).padStart(64, 'c')}`, seq: 100 + delivered.length }, 201);
      }
      if (path.endsWith('/messages')) return json({ records, next: records.length });
      if (path.includes('/beads/')) {
        const id = decodeURIComponent(path.split('/').pop() ?? '');
        const sealed = details.get(id);
        return sealed ? new Response(sealed, { status: 200 }) : json({ error: 'no such bead' }, 404);
      }
      if (path.includes('/blobs/')) return json({ error: 'expired' }, 404);
      return new Response('not found', { status: 404 });
    }),
  );
}

async function fresh(): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  delivered = [];
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.answers.clear(), db.shares.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM_PUB });
  await stubBackend();
}

async function openAt(search: string): Promise<void> {
  cleanup();
  window.history.pushState({}, '', `/${search}`);
  render(<App />);
}

async function liveAndUnlocked(): Promise<void> {
  await fresh();
  setKey(HIM_KEY);
}

afterAll(() => {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/cockpit.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('plans/0021 AC-1 (decision 8): the queue shows every kind of need, most blocking first, the recommendation first', ({ Given, When, Then, And }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    Then('the first need is the question "Where should the BSV library live?" with "New repo bsv-kit (recommended)" as its first answer', async () => {
      const first = (await screen.findAllByTestId('need-card'))[0];
      expect(first).toHaveTextContent('Where should the BSV library live?');
      const answers = within(within(first).getByRole('group', { name: 'Answers' })).getAllByRole('button');
      expect(answers[0]).toHaveAccessibleName('New repo bsv-kit (recommended)');
    });
    And('the queue also holds an approval, a step for his hands, a landing to verify and an alarm', async () => {
      const cards = await screen.findAllByTestId('need-card');
      const labels = cards.map((card) => card.getAttribute('aria-label') ?? '');
      for (const kind of ['Approve', 'Your hands', 'Verify', 'Alarm']) expect(labels.some((label) => label.startsWith(`${kind}:`))).toBe(true);
    });
  });

  Scenario('plans/0021 AC-2 (decisions 7, 8): tapping the recommendation answers the question and it leaves the queue', ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"New repo bsv-kit (recommended)" is tapped', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'New repo bsv-kit (recommended)' }));
    });
    Then('a reply naming "mw-2rbm.10" with the answer "New repo bsv-kit" is delivered directly to the Mayor', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      expect(JSON.parse(delivered[0])).toEqual({ bead: 'mw-2rbm.10', answer: 'New repo bsv-kit' });
    });
    And('the question leaves the queue', async () => {
      await waitFor(() => expect(screen.queryByRole('article', { name: 'Question: Where should the BSV library live?' })).toBeNull());
    });
  });

  Scenario('plans/0021 AC-3 (decision 7): releasing held work is one tap', ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Release" is tapped on the approval', async () => {
      const approval = await screen.findByRole('article', { name: 'Approve: Cockpit screens' });
      await userEvent.click(within(approval).getByRole('button', { name: 'Release' }));
    });
    Then('a release action for "mw-f758y.31" is delivered directly to the Mayor', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      expect(JSON.parse(delivered[0])).toEqual({ action: 'release', bead: 'mw-f758y.31' });
    });
  });

  Scenario('plans/0021 AC-4 (decision 10): unread words from the Mayor read as words, not JSON', ({ Given, When, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
    });
    Then('"Unread from the Mayor" shows the question as "Where should the BSV library live?"', async () => {
      const section = await screen.findByRole('region', { name: 'Unread from the Mayor' });
      await waitFor(() => expect(section).toHaveTextContent('Where should the BSV library live?'));
      expect(section.textContent).not.toContain('{"bead"');
    });
  });

  Scenario("plans/0021 AC-5 (decision 9): the map zooms from the factory to an epic's board", ({ Given, When, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the map is opened', async () => {
      await openAt('?v=map');
    });
    Then('the two maps are listed before the epics', async () => {
      const maps = await screen.findByRole('region', { name: 'Maps' });
      await waitFor(() => expect(within(maps).getAllByTestId('epic-card')).toHaveLength(2));
      expect(maps).toHaveTextContent("Postern: the Governor's cockpit");
      expect(maps).toHaveTextContent('The BSV library, built to its spec');
    });
    When('the epic "mw-f758y.30" is opened as a board', async () => {
      await openAt('?v=map&focus=mw-f758y.30&lens=board');
    });
    Then('its work sits in the columns Working, Ready and Blocked', async () => {
      const board = await screen.findByTestId('board');
      expect(within(within(board).getByRole('region', { name: 'Working' })).getAllByTestId('bead-card')).toHaveLength(2);
      expect(within(board).getByRole('region', { name: 'Ready' })).toHaveTextContent('GET /api/beads/{id} runs mw postern bead');
      expect(within(board).getByRole('region', { name: 'Blocked' })).toHaveTextContent('The cockpit reads the live view and the stream');
    });
  });

  Scenario("plans/0021 AC-6 (decisions 9, 10): a bead's page holds its detail and its whole conversation", ({ Given, When, Then, And }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the bead "mw-f758y.30.2" is opened', async () => {
      await openAt('?v=bead&id=mw-f758y.30.2');
    });
    Then("its acceptance criteria, its path and a Builder's comment are shown", async () => {
      expect(await screen.findByRole('button', { name: 'Acceptance criteria' })).toBeInTheDocument();
      expect(screen.getByText('tdd-feature')).toBeInTheDocument();
      expect(await screen.findByText('Hub and handler done, 14 tests. Working on the view watcher.')).toBeInTheDocument();
    });
    And('the voice note shows what was heard in it', async () => {
      expect(await screen.findByText(/Make the ping interval 25 seconds/)).toBeInTheDocument();
    });
  });

  Scenario('mw-f758y.24: an image he attached shows once, as his message, never as a desktop path', ({ Given, When, Then, And }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the bead "mw-f758y.30.2" is opened', async () => {
      await openAt('?v=bead&id=mw-f758y.30.2');
    });
    Then('the image he attached is shown once, with his words', async () => {
      await screen.findByText('Hub and handler done, 14 tests. Working on the view watcher.');
      await screen.findByText('The tile looks off');
      expect(screen.getAllByText('The tile looks off')).toHaveLength(1);
    });
    And('no desktop path is shown', () => {
      expect(screen.queryByText(/\/home\/jwhite/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\[image:/)).not.toBeInTheDocument();
    });
  });

  Scenario("plans/0021 AC-7 (decision 10): what he says on a bead's page goes to that bead's thread", ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the bead "mw-f758y.30.2" is opened', async () => {
      await openAt('?v=bead&id=mw-f758y.30.2');
      await screen.findByRole('button', { name: 'Acceptance criteria' });
    });
    And('"use 20 seconds instead" is sent from its composer', async () => {
      const composer = screen.getByTestId('composer');
      await userEvent.type(within(composer).getByLabelText('Message'), 'use 20 seconds instead');
      await userEvent.click(within(composer).getByRole('button', { name: 'Send' }));
    });
    Then('a message in the thread of "mw-f758y.30.2" saying "use 20 seconds instead" is delivered directly', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      expect(JSON.parse(delivered[0])).toEqual({ thread: { bead: 'mw-f758y.30.2' }, text: 'use 20 seconds instead' });
    });
  });

  Scenario('plans/0021 AC-8 (decision 13): one search finds beads and messages', ({ Given, When, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('"ping" is searched', async () => {
      await openAt('?v=search&q=ping');
    });
    Then('beads and messages that mention it are listed in their own groups', async () => {
      expect(await screen.findByTestId('hits-bead')).toHaveTextContent('GET /api/events streams message and view changes');
      expect(await screen.findByTestId('hits-message')).toHaveTextContent('Make the ping interval 25 seconds');
    });
  });

  Scenario('plans/0021 AC-9 (decision 14): one unlock lasts the day, across a relaunch', ({ Given, When, Then }) => {
    Given('the factory is live and his key was unlocked earlier today', async () => {
      await liveAndUnlocked();
      await waitFor(async () => expect(await db.session.get('daily')).toBeDefined());
    });
    When('the app relaunches', async () => {
      vi.resetModules();
      const fresh = await import('../../src/services/keySession');
      expect(fresh.getKey()).toBeNull();
      // The app module graph re-imports the fresh session; <App/> resumes it.
      const { App: RelaunchedApp } = await import('../../src/App');
      cleanup();
      window.history.pushState({}, '', '/');
      render(<RelaunchedApp />);
    });
    Then('it opens on the queue without asking to unlock', async () => {
      expect(await screen.findByRole('heading', { name: 'Needs you' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Recovery phrase')).toBeNull();
    });
  });

  Scenario('plans/0021 AC-11 (his hands, 2026-09-28): a step for his hands is approved from the queue and delivered signed', ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Approve and run" is tapped on the step "linger" and confirmed', async () => {
      const step = await screen.findByRole('listitem', { name: 'Step linger' });
      await userEvent.click(within(step).getByRole('button', { name: 'Approve and run' }));
      await userEvent.click(within(step).getByRole('button', { name: 'Confirm and run' }));
    });
    Then('a run action for step "linger" of "mw-f758y.8" is delivered, signed by his key over that exact step', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      const action = JSON.parse(delivered[0]) as { action: string; bead: string; step: string; sha256: string; approved_at: number; sig: string };
      expect(action).toMatchObject({ action: 'run', bead: 'mw-f758y.8', step: 'linger' });
      const expected = await stepSha256('mw-f758y.8', { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: 'loginctl disable-linger jwhite' });
      expect(action.sha256).toBe(expected);
      expect(Math.abs(action.approved_at - Date.now() / 1000)).toBeLessThan(60);
      expect(PublicKey.fromString(HIM_PUB).verify(approvalMessage(action.sha256, action.approved_at), Signature.fromDER(action.sig, 'hex'))).toBe(true);
    });
    And('a step that already ran shows its outcome instead of the buttons', async () => {
      const ran = await screen.findByRole('listitem', { name: 'Step nginx' });
      expect(ran).toHaveTextContent('ran');
      expect(within(ran).queryByRole('button', { name: 'Approve and run' })).toBeNull();
    });
  });

  Scenario('plans/0021 AC-10 (decision 12): a file shared from another app goes to the thread he picks', ({ Given, And, When, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    And('an image was shared into Postern from another app', async () => {
      await sharesRepo.put({ id: 's1', createdAt: Date.now(), files: [{ name: 'screen.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer }] });
    });
    When('the Share screen is opened and "Factory" is chosen', async () => {
      await openAt('?v=share&s=s1');
      await userEvent.click(await screen.findByRole('button', { name: /Factory/ }));
    });
    Then('the Factory thread opens with the image waiting in its composer', async () => {
      const composer = await screen.findByTestId('composer');
      expect(await within(composer).findByRole('button', { name: 'Remove screen.png' })).toBeInTheDocument();
      expect(window.location.search).toBe('?v=talk&t=general');
    });
  });
});
