// features/steps/outbox.steps.tsx — runs features/outbox.feature (mw-jrx0s.10): what he taps,
// answers and says is written to the Dexie outbox first, shown pending, and sent in order by
// the real sender. Only the delivery calls are doubled: a backend that is up or out of reach.
import '@testing-library/react/dont-cleanup-after-each';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { sendAction, sendTurn } from '../../src/cockpit/send';
import { db, type MessageRow } from '../../src/data/db';
import { outboxRepo } from '../../src/data/repositories';
import { forgetOutboxState, kickOutbox, settledOutbox, startOutbox } from '../../src/services/outbox';
import { settledWrites } from '../../src/services/deliver';
import type { Need } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

// The backend: while it is out of reach every delivery fails as a dropped connection does.
const backend = vi.hoisted(() => ({
  up: false,
  refuseOnce: false,
  heard: [] as string[],
  txids: 0,
}));

vi.mock('../../src/services/deliver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/deliver')>();
  function reach(heard: string) {
    if (backend.refuseOnce) {
      backend.refuseOnce = false;
      throw new TypeError('Failed to fetch');
    }
    if (!backend.up) throw new TypeError('Failed to fetch');
    backend.heard.push(heard);
    return { txid: `direct:${++backend.txids}`, channel: 'direct' as const };
  }
  return {
    ...actual,
    deliverAnswer: vi.fn(async (bead: string, answer: string) => reach(`answer ${bead} ${answer}`)),
    deliverAction: vi.fn(async (action: { action: string; bead: string }) => reach(`${action.action} ${action.bead}`)),
    deliverThreaded: vi.fn(async (message: { text: string }) => reach(`message ${message.text}`)),
  };
});
vi.mock('../../src/services/talk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/talk')>()),
  deliverTurn: vi.fn(async (turn: { text: string }) => {
    if (!backend.up) throw new TypeError('Failed to fetch');
    backend.heard.push(`turn ${turn.text}`);
    return { txid: `direct:${++backend.txids}`, channel: 'direct' as const };
  }),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => {
  const key = new Uint8Array(32);
  return { ...(await importOriginal<typeof import('../../src/services/keySession')>()), getKey: () => key };
});

const BEAD = 'mw-q';
const TOPIC = 'topic:ops';

function question(options: string[]): Need {
  return { kind: 'question', bead: BEAD, epic: '', title: 'Paint the door', since: new Date(Date.now() - 60_000).toISOString(), text: 'Shall we?', recommended: '', options, blocks: 0, steps: [] };
}

let stopOutbox: (() => void) | undefined;

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  stopOutbox?.();
  forgetOutboxState();
  backend.up = false;
  backend.refuseOnce = false;
  backend.heard = [];
  backend.txids = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.outbox.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
  // The app is open: the sender listens for the phone coming back.
  stopOutbox = startOutbox();
}

afterAll(() => {
  stopOutbox?.();
  forgetOutboxState();
  cleanup();
  window.history.pushState({}, '', '/');
});

/** The backend is reachable again and the phone hears of it (the browser's `online`, a live reconnect). */
async function backendBack(): Promise<void> {
  backend.up = true;
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await settledOutbox();
  });
}

const pendingMark = () => screen.queryAllByTestId('pending-mark');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

function sentRecord(over: Partial<MessageRow>): MessageRow {
  return { id: 'direct:9:0', txid: 'direct:9', vout: 0, seq: 5, class: 'message', to: '02aa', from: '02bb', ts: Math.floor(Date.now() / 1000), ciphertext: '', plaintext: '', direction: 'sent', read: true, thread: TOPIC, ...over };
}

const feature = await loadFeature('features/outbox.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-jrx0s.10: a tap while offline shows pending at once and is sent when the backend answers', ({ Given, And, When, Then }) => {
    Given('the backend cannot be reached', () => {
      backend.up = false;
    });
    And('a question card with the options {string} and {string}', (_c, a: string, b: string) => {
      render(
        <>
          <OutboxNote />
          <NeedCard need={question([a, b])} />
        </>,
      );
    });
    When('he taps {string}', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
    });
    Then('the card is dead and shows the mark {string}', async (_c, mark: string) => {
      await waitFor(() => expect(within(screen.getByTestId('need-card')).getByTestId('pending-mark')).toHaveTextContent(mark));
      for (const button of within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')) expect(button).toBeDisabled();
    });
    And('the status line says {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByRole('status', { name: 'Outgoing' })).toHaveTextContent(words));
    });
    And('the outbox holds one pending answer', async () => {
      const rows = await outboxRepo.all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'answer', bead: BEAD, state: 'pending' });
    });
    When('the backend answers again', backendBack);
    Then('the answer {string} has gone to the backend once', async (_c, answer: string) => {
      await waitFor(() => expect(backend.heard).toEqual([`answer ${BEAD} ${answer}`]));
    });
    And('the card shows no pending mark and says {string}', async (_c, words: string) => {
      await waitFor(() => expect(pendingMark()).toHaveLength(0));
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toContain(words));
    });
    And('the status line says nothing', async () => {
      await waitFor(() => expect(screen.queryByRole('status', { name: 'Outgoing' })).toBeNull());
    });
  });

  Scenario('mw-jrx0s.10: two taps go out in order', ({ Given, When, And, Then }) => {
    Given('the backend cannot be reached', () => {
      backend.up = false;
    });
    When('he taps {string} on bead {string} and then {string} on bead {string}', async (_c, first: string, a: string, second: string, b: string) => {
      await sendAction({ action: first.toLowerCase(), bead: a });
      await sendAction({ action: second.toLowerCase(), bead: b });
      expect((await outboxRepo.all()).map((row) => row.state)).toEqual(['pending', 'pending']);
    });
    And('the backend answers again', backendBack);
    Then('the backend heard {string} first and {string} second', async (_c, first: string, second: string) => {
      await waitFor(() => expect(backend.heard).toEqual([first, second]));
    });
  });

  Scenario('mw-jrx0s.10: a failed send is tried again and keeps its place in the order', ({ Given, When, And, Then }) => {
    Given('the backend refuses the first try', () => {
      backend.up = true;
      backend.refuseOnce = true;
    });
    When('he taps {string} on bead {string} and then {string} on bead {string}', async (_c, first: string, a: string, second: string, b: string) => {
      await sendAction({ action: first.toLowerCase(), bead: a });
      await sendAction({ action: second.toLowerCase(), bead: b });
      await settledOutbox();
      // the second did not overtake the first while it waited for its next try
      expect(backend.heard).toEqual([]);
      const [head] = await outboxRepo.all();
      expect(head.attempts).toBe(1);
    });
    And('the sender is woken', async () => {
      await act(async () => {
        kickOutbox(true);
        await settledOutbox();
      });
    });
    Then('the backend heard {string} first and {string} second', async (_c, first: string, second: string) => {
      await waitFor(() => expect(backend.heard).toEqual([first, second]));
    });
  });

  Scenario('mw-jrx0s.10: a reload keeps the pending tap and sends it', ({ Given, And, When, Then }) => {
    Given('the backend cannot be reached', () => {
      backend.up = false;
    });
    And('a question card with the options {string} and {string}', (_c, a: string, b: string) => {
      render(<NeedCard need={question([a, b])} />);
    });
    When('he taps {string}', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
      await waitFor(() => expect(pendingMark()).toHaveLength(1));
    });
    And('the app is reloaded', async () => {
      cleanup();
      forgetTaps();
      stopOutbox?.();
      forgetOutboxState();
      expect(await outboxRepo.all()).toHaveLength(1);
      // The reloaded card is dead before anything is sent: the pending row says so.
      render(<NeedCard need={question(['Yes', 'No'])} />);
      await waitFor(() => expect(pendingMark()).toHaveLength(1));
      for (const button of within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')) expect(button).toBeDisabled();
    });
    And('the backend answers again', () => {
      backend.up = true;
    });
    And('the app opens', async () => {
      await act(async () => {
        stopOutbox = startOutbox();
        await settledOutbox();
      });
    });
    Then('the answer {string} has gone to the backend once', async (_c, answer: string) => {
      await waitFor(() => expect(backend.heard).toEqual([`answer ${BEAD} ${answer}`]));
      await waitFor(() => expect(pendingMark()).toHaveLength(0));
    });
  });

  Scenario('mw-jrx0s.10: a message typed offline shows pending in its thread and is sent when back online', ({ Given, And, When, Then }) => {
    Given('the backend cannot be reached', () => {
      backend.up = false;
    });
    And('the Talk channel {string} is open', (_c, name: string) => {
      window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(`topic:${name}`)}`);
      render(<TalkScreen thread={`topic:${name}`} />);
    });
    When('he sends {string} from the composer', async (_c, words: string) => {
      fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: words } });
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    Then('the composer is empty', async () => {
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    });
    And('the thread shows {string} with the mark {string}', async (_c, words: string, mark: string) => {
      await waitFor(() => {
        const bubble = within(screen.getByTestId('conversation')).getByText(words).closest('[data-testid="message"]') as HTMLElement;
        expect(within(bubble).getByTestId('pending-mark')).toHaveTextContent(mark);
      });
    });
    When('the backend answers again', backendBack);
    Then('the message {string} has gone to the backend once', async (_c, words: string) => {
      await waitFor(() => expect(backend.heard).toEqual([`message ${words}`]));
    });
  });

  Scenario('mw-jrx0s.10: a sent message is acked when its record arrives by since-paging', ({ Given, And, When, Then }) => {
    Given('a sent message whose record the phone has not seen yet', async () => {
      await db.outbox.add({ kind: 'message', bead: '', thread: TOPIC, payload: { text: 'Held on', files: [] }, created: Date.now(), attempts: 1, txid: 'direct:9', state: 'sent' });
      window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(TOPIC)}`);
      render(<TalkScreen thread={TOPIC} />);
    });
    And('the thread shows {string} with the mark {string}', async (_c, words: string, mark: string) => {
      await waitFor(() => {
        const bubble = within(screen.getByTestId('conversation')).getByText(words).closest('[data-testid="message"]') as HTMLElement;
        expect(within(bubble).getByTestId('pending-mark')).toHaveTextContent(mark);
      });
    });
    When('the record arrives by since-paging', async () => {
      await act(async () => {
        await db.messages.put(sentRecord({ plaintext: JSON.stringify({ thread: { topic: 'ops' }, text: 'Held on' }) }));
        kickOutbox();
        await settledOutbox();
      });
    });
    Then('the outbox row is acked', async () => {
      await waitFor(async () => expect((await outboxRepo.all()).map((row) => row.state)).toEqual(['acked']));
    });
    And('the thread shows {string} with no pending mark', async (_c, words: string) => {
      await waitFor(() => expect(within(screen.getByTestId('conversation')).getByText(words)).toBeInTheDocument());
      expect(pendingMark()).toHaveLength(0);
    });
  });

  Scenario('mw-jrx0s.10: a sent answer is acked when its card_answered event arrives', ({ Given, When, Then }) => {
    Given('a sent action whose event the phone has not heard yet', async () => {
      await db.outbox.add({ kind: 'answer', bead: BEAD, payload: { answer: 'Yes' }, created: Date.now(), attempts: 1, txid: 'direct:7', state: 'sent' });
      await act(async () => {
        kickOutbox();
        await settledOutbox();
      });
      expect((await outboxRepo.all()).map((row) => row.state)).toEqual(['sent']);
    });
    When('the card_answered event arrives with the same txid', async () => {
      await act(async () => {
        await db.events.add({ seq: 1, ts: new Date().toISOString(), kind: 'card_answered', bead: BEAD, actor: 'governor', from: '', to: '', detail: 'direct:7', lane: '' });
        kickOutbox();
        await settledOutbox();
      });
    });
    Then('the outbox row is acked', async () => {
      await waitFor(async () => expect((await outboxRepo.all()).map((row) => row.state)).toEqual(['acked']));
    });
  });

  Scenario('mw-jrx0s.10: a Talk turn is queued and shown pending', ({ Given, When, Then }) => {
    Given('the backend cannot be reached', () => {
      backend.up = false;
    });
    When('a Talk turn {string} is sent', async (_c, words: string) => {
      await sendTurn({ talk: { id: 'talk-1', turn: 1 }, text: words, role: 'turn' });
    });
    Then('the outbox holds one pending turn', async () => {
      await settledOutbox();
      const rows = await outboxRepo.all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'turn', state: 'pending' });
    });
    When('the backend answers again', backendBack);
    Then('the turn {string} has gone to the backend once', async (_c, words: string) => {
      await waitFor(() => expect(backend.heard).toEqual([`turn ${words}`]));
      await settledWrites();
    });
  });

  Scenario('mw-jrx0s.10: the app never says it could not send', ({ Then }) => {
    Then('no file under src says {string}', (_c, words: string) => {
      const found = sourceFiles('src').filter((file) => readFileSync(file, 'utf8').includes(words));
      expect(found).toEqual([]);
    });
  });
});
