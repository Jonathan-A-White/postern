// features/steps/cockpit.steps.tsx — runs features/cockpit.feature: the whole
// app (<App />) against a stubbed v2 backend (docs/protocol.md §9–§15) serving
// tests/support/cockpit-fixture.ts, with his key already unlocked for the day.
// Every POST /api/messages is decrypted with the Mayor's key so a scenario can
// say exactly what reached him.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LockingScript, PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { App } from '../../src/App';
import { db } from '../../src/data/db';
import { sharesRepo, vaultRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { stopLive } from '../../src/services/live';
import { decryptMessage, encryptMessage, type MessagePayload } from '../../src/services/messages';
import { sealDocument } from '../../src/services/documents';
import { MAYOR, STALE_FACTS_END, fixtureDetail, fixtureRecords, fixtureStaleNeed, fixtureView } from '../../tests/support/cockpit-fixture';
import { approvalMessage, stepSha256 } from '../../src/model/hands';

// The whole app syncs messages, the view and a bead's detail before a scenario's
// words appear; on a loaded host that can take longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 });

const HIM = PrivateKey.fromHex('5a'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const HIM_PUB = HIM.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();

let delivered: string[] = [];
// mw-t64a3.3: a message POST can be held until a scenario lets it through, or refused once.
let sendGate: { promise: Promise<void>; open: () => void } | undefined;
let refuseNext = false;

function holdSends(): void {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  sendGate = { promise, open };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// mw-t64a3.21: the Mayor's links to a bead, as they reach him: the app's own address.
const BEAD_LINK = `${window.location.origin}/?v=bead&id=mw-f758y.30.2`;

type BackendOptions = { beadlessAlarm?: boolean; stale?: boolean; links?: boolean };

async function stubBackend(options: BackendOptions = {}): Promise<void> {
  const now = Date.now();
  const fixture = fixtureView(now);
  if (options.beadlessAlarm) fixture.needs = fixture.needs.map((need) => (need.kind === 'alarm' ? { ...need, bead: '', epic: '' } : need));
  if (options.stale) fixture.needs = [...fixture.needs, fixtureStaleNeed(now)];
  if (options.links) fixture.needs = fixture.needs.map((need) => (need.kind === 'alarm' ? { ...need, text: `${need.text}\n\n[Open the alarm's bead](${BEAD_LINK})` } : need));
  const view = await sealDocument(JSON.stringify(fixture), MAYOR.toHex(), HIM_PUB);
  const records = fixtureRecords(HIM, now);
  if (options.links) {
    const payload = encryptMessage({ text: `Details are on [Open the bead](${BEAD_LINK}).`, class: 'message', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: HIM_PUB });
    records.push({ seq: records.length + 1, txid: `direct:${'d'.repeat(64)}`, vout: 0, payload: { ...payload, ts: Math.floor(now / 1000) - 60 } });
  }
  const details = new Map<string, string>();
  for (const id of ['mw-f758y.30.2', 'mw-2rbm.10', 'mw-gq6.132']) details.set(id, await sealDocument(JSON.stringify(fixtureDetail(id, now)), MAYOR.toHex(), HIM_PUB));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path.endsWith('/challenge')) return json({ nonce: crypto.randomUUID().replace(/-/g, '') });
      if (path.endsWith('/me')) return json({ pubkey: HIM_PUB, mayor: MAYOR_PUB, network: 'testnet', features: ['direct', 'view', 'beads', 'me'] });
      if (path.endsWith('/view')) return new Response(view, { status: 200, headers: { ETag: '"fixture"' } });
      if (path.endsWith('/messages') && init?.method === 'POST') {
        if (refuseNext) {
          refuseNext = false;
          return json({}, 422);
        }
        const { scriptHex } = JSON.parse(String(init.body)) as { scriptHex: string };
        const decoded = decodeRecordScript(LockingScript.fromHex(scriptHex))!;
        const payload = JSON.parse(Utils.toUTF8(Array.from(decoded.payloadBytes))) as MessagePayload;
        delivered.push(decryptMessage(payload, MAYOR.toHex()));
        await sendGate?.promise;
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

// Lets a held send through and waits until it is remembered, so it cannot finish under the next scenario.
async function letTheSendFinish(bead: string): Promise<void> {
  sendGate?.open();
  await waitFor(async () => expect(await db.answers.get(bead)).toBeDefined());
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function fresh(options: BackendOptions = {}): Promise<void> {
  cleanup();
  stopLive();
  lock();
  vi.unstubAllGlobals();
  forgetTaps();
  sendGate?.open();
  sendGate = undefined;
  refuseNext = false;
  delivered = [];
  await Promise.all([db.vault.clear(), db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.answers.clear(), db.shares.clear(), db.session.clear()]);
  await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(48), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: HIM_PUB });
  await stubBackend(options);
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

async function liveWithLinks(): Promise<void> {
  await fresh({ links: true });
  setKey(HIM_KEY);
}

async function liveWithStaleBead(): Promise<void> {
  await fresh({ stale: true });
  setKey(HIM_KEY);
}

const STALE_CARD = 'Still wanted?: Laptop boost: bd on the desktop Dolt server';

async function staleCard(): Promise<HTMLElement> {
  return screen.findByRole('article', { name: STALE_CARD });
}

async function nothingIsSent(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(delivered).toHaveLength(0);
}

async function oneActionIsSent(action: string, bead: string): Promise<void> {
  await waitFor(() => expect(delivered).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(delivered).toHaveLength(1);
  expect(JSON.parse(delivered[0])).toEqual({ action, bead });
}

async function liveWithBeadlessAlarm(): Promise<void> {
  await fresh({ beadlessAlarm: true });
  setKey(HIM_KEY);
}

async function replyOn(card: HTMLElement, text: string): Promise<void> {
  await userEvent.click(within(card).getByRole('button', { name: 'Reply' }));
  await userEvent.type(within(card).getByRole('textbox', { name: 'Your reply' }), text);
  await userEvent.click(within(card).getByRole('button', { name: 'Send' }));
}

async function toastSaying(text: string): Promise<HTMLElement> {
  return (await screen.findByText(text)).closest('[role="status"]') as HTMLElement;
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

  Scenario('mw-f758y.23: the map\'s list shows the newest activity first, not the oldest ids', ({ Given, When, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the epic "mw-f758y.30" is opened as a list', async () => {
      await openAt('?v=map&focus=mw-f758y.30&lens=list');
    });
    Then('its work is listed newest activity first', async () => {
      const list = await screen.findByTestId('bead-list');
      const rows = () => within(list).getAllByRole('listitem').map((row) => row.textContent ?? '');
      await waitFor(() => expect(rows()).toHaveLength(5));
      // active 3, 6, 95 (closed), 120 and 120 minutes ago (the last two tie, so board order: priority then title)
      const titles = ['GET /api/events streams', 'mw postern view writes', 'POST /api/messages takes', 'The cockpit reads', 'GET /api/beads/{id}'];
      titles.forEach((title, i) => expect(rows()[i]).toContain(title));
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

  Scenario('mw-t64a3.1: a reply on an alarm with no bead says it went to Factory, and Open shows that thread', ({ Given, When, And, Then }) => {
    Given('the factory is live with an alarm that names no bead and his key is unlocked', liveWithBeadlessAlarm);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"On it, thanks" is sent as a reply on the alarm', async () => {
      await replyOn(await screen.findByRole('article', { name: /^Alarm:/ }), 'On it, thanks');
    });
    Then('a toast says "Sent to the Mayor in Factory"', async () => {
      expect(await toastSaying('Sent to the Mayor in Factory')).toBeInTheDocument();
      expect(delivered).toHaveLength(1);
    });
    When('"Open" is tapped on the toast', async () => {
      await userEvent.click(within(await toastSaying('Sent to the Mayor in Factory')).getByRole('button', { name: 'Open' }));
    });
    Then('the Talk thread "Factory" shows "On it, thanks" and the Mayor\'s earlier "Good morning" message', async () => {
      expect(window.location.search).toBe('?v=talk&t=general');
      const conversation = await screen.findByTestId('conversation');
      await waitFor(() => expect(conversation).toHaveTextContent('Good morning'));
      expect(conversation).toHaveTextContent('On it, thanks');
    });
  });

  Scenario("mw-t64a3.1: a reply on a bead's card says it went to that bead, and Open shows its thread", ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Hold this one" is sent as a reply on the approval', async () => {
      await replyOn(await screen.findByRole('article', { name: 'Approve: Cockpit screens' }), 'Hold this one');
    });
    Then('a toast says "Sent to the Mayor in mw-f758y.31"', async () => {
      expect(await toastSaying('Sent to the Mayor in mw-f758y.31')).toBeInTheDocument();
    });
    When('"Open" is tapped on the toast', async () => {
      await userEvent.click(within(await toastSaying('Sent to the Mayor in mw-f758y.31')).getByRole('button', { name: 'Open' }));
    });
    Then('the Talk thread "mw-f758y.31" shows "Hold this one"', async () => {
      expect(window.location.search).toBe('?v=talk&t=bead%3Amw-f758y.31');
      const conversation = await screen.findByTestId('conversation');
      await waitFor(() => expect(conversation).toHaveTextContent('Hold this one'));
    });
  });
  Scenario('mw-t64a3.3: one tap on Release sends once, shows it was sent at once, and cannot be tapped again', ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    And('the backend is slow to take a message', holdSends);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Release" is tapped twice on the approval', async () => {
      const approval = await screen.findByRole('article', { name: 'Approve: Cockpit screens' });
      const release = within(approval).getByRole('button', { name: 'Release' });
      fireEvent.click(release);
      fireEvent.click(release);
    });
    Then('one release action for "mw-f758y.31" is sent', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(delivered).toHaveLength(1);
      expect(JSON.parse(delivered[0])).toEqual({ action: 'release', bead: 'mw-f758y.31' });
    });
    And('the approval says it was sent and is waiting for the factory, with no Release button to tap', async () => {
      const approval = screen.getByRole('article', { name: 'Approve: Cockpit screens' });
      expect(within(approval).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
      expect(within(approval).queryByRole('button', { name: 'Release' })).toBeNull();
      await letTheSendFinish('mw-f758y.31');
    });
  });

  Scenario('mw-t64a3.3: a failed send says so on the card and gives the button back', ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    And('the backend refuses the next message', () => {
      refuseNext = true;
    });
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Release" is tapped on the approval', async () => {
      const approval = await screen.findByRole('article', { name: 'Approve: Cockpit screens' });
      await userEvent.click(within(approval).getByRole('button', { name: 'Release' }));
    });
    Then('a toast says "The backend refused the message."', async () => {
      expect(await screen.findByText('The backend refused the message.')).toBeInTheDocument();
    });
    And('the approval offers "Release" again', async () => {
      const approval = screen.getByRole('article', { name: 'Approve: Cockpit screens' });
      await waitFor(() => expect(within(approval).getByRole('button', { name: 'Release' })).toBeEnabled());
      expect(within(approval).queryByRole('status')).toBeNull();
    });
  });

  Scenario("mw-t64a3.3: one tap on Verified on the bead's page sends once and cannot be tapped again", ({ Given, When, And, Then }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    And('the backend is slow to take a message', holdSends);
    When('the bead "mw-gq6.130" is opened', async () => {
      await openAt('?v=bead&id=mw-gq6.130');
      await screen.findByLabelText('Actions');
    });
    And('"Verified" is tapped twice on the bead\'s page', async () => {
      const verified = (await screen.findAllByRole('button', { name: 'Verified' }))[0];
      fireEvent.click(verified);
      fireEvent.click(verified);
    });
    Then('one verified action for "mw-gq6.130" is sent', async () => {
      await waitFor(() => expect(delivered).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(delivered).toHaveLength(1);
      expect(JSON.parse(delivered[0])).toEqual({ action: 'verified', bead: 'mw-gq6.130' });
    });
    And("the bead's page says it was sent and is waiting for the factory, with no Verified button to tap", async () => {
      expect(screen.getAllByText(/waiting for the factory/i).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Verified' })).toBeNull();
      await letTheSendFinish('mw-gq6.130');
    });
  });

  Scenario('mw-2y46l.5: a stale need shows Still wanted? with its facts in full and a Keep and a Close', ({ Given, When, Then, And }) => {
    Given('the factory is live with a stale bead and his key is unlocked', liveWithStaleBead);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    Then('the stale card is chipped "Still wanted?" and shows its facts in full', async () => {
      const card = await staleCard();
      expect(within(card).getByText('Still wanted?', { selector: 'span' })).toBeInTheDocument();
      expect(within(card).getByText(new RegExp(STALE_FACTS_END.slice(0, 30)))).toBeInTheDocument();
      expect(within(card).getByText(/nobody has touched it since/)).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Read all' })).toBeNull();
    });
    And('the stale card offers "Keep" and "Close" and nothing else to tap for an answer', async () => {
      const card = await staleCard();
      const answers = within(card).getByRole('group', { name: 'Answers' });
      expect(within(answers).getAllByRole('button').map((button) => button.textContent)).toEqual(['Keep', 'Close']);
    });
  });

  Scenario('mw-2y46l.5: Keep sends one keep action', ({ Given, When, And, Then }) => {
    Given('the factory is live with a stale bead and his key is unlocked', liveWithStaleBead);
    And('the backend is slow to take a message', holdSends);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Keep" is tapped on the stale card', async () => {
      await userEvent.click(within(await staleCard()).getByRole('button', { name: 'Keep' }));
    });
    Then('one keep action for "mw-gq6.132" is sent', () => oneActionIsSent('keep', 'mw-gq6.132'));
    And('the stale card says it was sent and is waiting for the factory', async () => {
      expect(within(await staleCard()).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
      await letTheSendFinish('mw-gq6.132');
    });
  });

  Scenario('mw-2y46l.5: Close asks once, Cancel sends nothing, Close sends one close action', ({ Given, When, And, Then }) => {
    Given('the factory is live with a stale bead and his key is unlocked', liveWithStaleBead);
    And('the backend is slow to take a message', holdSends);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Close" is tapped on the stale card', async () => {
      await userEvent.click(within(await staleCard()).getByRole('button', { name: 'Close' }));
    });
    Then('the stale card asks "Close mw-gq6.132 and its held stories?" and nothing is sent', async () => {
      const card = await staleCard();
      expect(within(card).getByText('Close mw-gq6.132 and its held stories?')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Keep' })).toBeNull();
      await nothingIsSent();
    });
    When('"Cancel" is tapped on the stale card', async () => {
      await userEvent.click(within(await staleCard()).getByRole('button', { name: 'Cancel' }));
    });
    Then('the stale card offers "Keep" and "Close" again and nothing is sent', async () => {
      const card = await staleCard();
      expect(within(card).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Close' })).toBeInTheDocument();
      expect(within(card).queryByText('Close mw-gq6.132 and its held stories?')).toBeNull();
      await nothingIsSent();
    });
    When('"Close" is tapped on the stale card', async () => {
      await userEvent.click(within(await staleCard()).getByRole('button', { name: 'Close' }));
    });
    And('"Close" is confirmed on the stale card', async () => {
      const card = await staleCard();
      await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
    });
    Then('one close action for "mw-gq6.132" is sent', () => oneActionIsSent('close', 'mw-gq6.132'));
    And('the stale card says it was sent and is waiting for the factory', async () => {
      expect(within(await staleCard()).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
      await letTheSendFinish('mw-gq6.132');
    });
  });

  Scenario('mw-2y46l.5: a second tap on a stale card sends nothing', ({ Given, When, And, Then }) => {
    Given('the factory is live with a stale bead and his key is unlocked', liveWithStaleBead);
    And('the backend is slow to take a message', holdSends);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('"Keep" is tapped twice on the stale card', async () => {
      const keep = within(await staleCard()).getByRole('button', { name: 'Keep' });
      fireEvent.click(keep);
      fireEvent.click(keep);
    });
    Then('one keep action for "mw-gq6.132" is sent', () => oneActionIsSent('keep', 'mw-gq6.132'));
    And('the stale card says it was sent and is waiting for the factory', async () => {
      expect(within(await staleCard()).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
    });
    And('the stale card offers neither "Keep" nor "Close"', async () => {
      const card = await staleCard();
      expect(within(card).queryByRole('button', { name: 'Keep' })).toBeNull();
      expect(within(card).queryByRole('button', { name: 'Close' })).toBeNull();
      await letTheSendFinish('mw-gq6.132');
    });
  });

  Scenario("mw-2y46l.5: the bead's page shows Keep and Close when the bead has a stale need", ({ Given, When, And, Then }) => {
    Given('the factory is live with a stale bead and his key is unlocked', liveWithStaleBead);
    And('the backend is slow to take a message', holdSends);
    When('the bead "mw-gq6.132" is opened', async () => {
      await openAt('?v=bead&id=mw-gq6.132');
      await screen.findByLabelText('Actions');
    });
    Then('the bead\'s actions offer "Keep" and "Close"', async () => {
      const actions = await screen.findByLabelText('Actions');
      await waitFor(() => expect(within(actions).getByRole('button', { name: 'Keep' })).toBeInTheDocument());
      expect(within(actions).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
    When('"Keep" is tapped on the bead\'s actions', async () => {
      await userEvent.click(within(screen.getByLabelText('Actions')).getByRole('button', { name: 'Keep' }));
    });
    Then('one keep action for "mw-gq6.132" is sent', () => oneActionIsSent('keep', 'mw-gq6.132'));
    And("the bead's actions say it was sent and are waiting for the factory, with no Keep or Close to tap", async () => {
      const actions = screen.getByLabelText('Actions');
      expect(within(actions).getByRole('status')).toHaveTextContent(/waiting for the factory/i);
      expect(within(actions).queryByRole('button', { name: 'Keep' })).toBeNull();
      expect(within(actions).queryByRole('button', { name: 'Close' })).toBeNull();
      await letTheSendFinish('mw-gq6.132');
    });
  });

  Scenario('mw-t64a3.21: a link in a Talk message opens the bead in the app, and Back shows the same thread again', ({ Given, When, Then, And }) => {
    Given('the factory is live with links in its words and his key is unlocked', liveWithLinks);
    When('the Talk thread "Factory" is opened', async () => {
      await openAt('?v=talk&t=general');
    });
    And('the link in the Mayor\'s message is tapped', async () => {
      const conversation = await screen.findByTestId('conversation');
      await userEvent.click(await within(conversation).findByRole('link', { name: 'Open the bead' }));
    });
    Then('the bead page of "mw-f758y.30.2" is shown', async () => {
      expect(await screen.findByRole('button', { name: 'Acceptance criteria' })).toBeInTheDocument();
      expect(window.location.search).toBe('?v=bead&id=mw-f758y.30.2');
    });
    When('the header Back is tapped', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    Then('the Talk thread "Factory" shows the message with the link, not the Map or the thread list', async () => {
      await waitFor(() => expect(window.location.search).toBe('?v=talk&t=general'));
      const conversation = await screen.findByTestId('conversation');
      expect(await within(conversation).findByRole('link', { name: 'Open the bead' })).toBeInTheDocument();
    });
  });

  Scenario('mw-t64a3.21: a link in a Needs card opens the bead in the app, and Back shows Needs you', ({ Given, When, Then, And }) => {
    Given('the factory is live with links in its words and his key is unlocked', liveWithLinks);
    When('the cockpit opens', async () => {
      await openAt('');
      await screen.findAllByTestId('need-card');
    });
    And('the link in the alarm card is tapped', async () => {
      await userEvent.click(await within(await screen.findByRole('article', { name: /^Alarm:/ })).findByRole('link', { name: "Open the alarm's bead" }));
    });
    Then('the bead page of "mw-f758y.30.2" is shown', async () => {
      expect(await screen.findByRole('button', { name: 'Acceptance criteria' })).toBeInTheDocument();
      expect(window.location.search).toBe('?v=bead&id=mw-f758y.30.2');
    });
    When('the header Back is tapped', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    Then('Needs you shows its cards again', async () => {
      await waitFor(() => expect(window.location.search).toBe(''));
      expect((await screen.findAllByTestId('need-card')).length).toBeGreaterThan(1);
    });
  });

  Scenario('mw-t64a3.21: a bead page opened cold still goes Back to the Map', ({ Given, When, Then, And }) => {
    Given('the factory is live and his key is unlocked', liveAndUnlocked);
    When('the bead "mw-f758y.30.2" is opened', async () => {
      await openAt('?v=bead&id=mw-f758y.30.2');
    });
    And('the header Back is tapped', async () => {
      await screen.findByRole('button', { name: 'Acceptance criteria' });
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    });
    Then('the Map is shown', async () => {
      await waitFor(() => expect(window.location.search).toMatch(/^\?v=map/), { timeout: 3000 });
    });
  });
});
