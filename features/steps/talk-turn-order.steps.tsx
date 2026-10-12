// features/steps/talk-turn-order.steps.tsx — runs features/talk-turn-order.feature (mw-q6n8m0.12):
// the real sender and the real outbox, with only the delivery of a turn doubled. A turn that is
// refused for good, or that went on the chain, must hold back the turns he spoke after it.
import { waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { sendTurn } from '../../src/cockpit/send';
import { RefusedError } from '../../src/services/apiAuth';
import { db } from '../../src/data/db';
import { outboxRepo } from '../../src/data/repositories';
import { discardRow, forgetOutboxState, kickOutbox, retryRow, startOutbox } from '../../src/services/outbox';
import type { TalkTurn } from '../../src/model/talkLine';

const backend = vi.hoisted(() => ({
  /** What each turn's words meet: refused for good, put on the chain, or taken directly (the default). */
  fate: new Map<string, 'refuse' | 'chain'>(),
  heard: [] as string[],
  txids: 0,
}));

vi.mock('../../src/services/talk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/talk')>()),
  deliverTurn: vi.fn(async (turn: { text: string }) => {
    const fate = backend.fate.get(turn.text);
    if (fate === 'refuse') throw new RefusedError('not allowed', 403);
    backend.heard.push(turn.text);
    const n = ++backend.txids;
    return fate === 'chain' ? { txid: n.toString(16).padStart(64, 'c'), channel: 'chain' as const } : { txid: `direct:${n}`, channel: 'direct' as const };
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

let stopOutbox: (() => void) | undefined;

async function fresh(): Promise<void> {
  stopOutbox?.();
  forgetOutboxState();
  backend.fate.clear();
  backend.heard = [];
  backend.txids = 0;
  await Promise.all([db.settings.clear(), db.messages.clear(), db.events.clear(), db.outbox.clear()]);
  stopOutbox = startOutbox();
}

afterAll(() => {
  stopOutbox?.();
  forgetOutboxState();
});

let said = 0;
async function say(...words: string[]): Promise<void> {
  for (const text of words) {
    const turn: TalkTurn = { talk: { id: 'talk-38dc7b04', turn: ++said }, text, role: 'turn' };
    await sendTurn(turn);
  }
}

const rowFor = async (text: string) => (await outboxRepo.all()).find((row) => (row.payload.turn as TalkTurn).text === text);

const feature = await loadFeature('features/talk-turn-order.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    said = 0;
    await fresh();
  });

  Scenario('mw-q6n8m0.12 AC-1: a turn the backend refused holds back the turns he spoke after it until he taps Retry', ({ Given, And, When, Then }) => {
    Given('the backend is up', () => {});
    And('the backend refuses the Talk turn {string} for good, saying {string}', (_c, text: string) => {
      backend.fate.set(text, 'refuse');
    });
    When('he says {string}, {string} and {string} on the Talk line', async (_c, a: string, b: string, c: string) => {
      await say(a, b, c);
    });
    Then('the Mayor has heard no turns', async () => {
      await waitFor(async () => expect((await rowFor('turn four'))?.state).toBe('failed'));
      expect(backend.heard).toEqual([]);
    });
    And('{string} and {string} still show as waiting to go', async (_c, a: string, b: string) => {
      expect((await rowFor(a))?.state).toBe('pending');
      expect((await rowFor(b))?.state).toBe('pending');
    });
    When('the backend lets {string} through and he taps Retry on it', async (_c, text: string) => {
      backend.fate.delete(text);
      await retryRow((await rowFor(text))?.id as number);
    });
    Then('the Mayor heard {string}, {string} and {string}, in that order, once each', async (_c, a: string, b: string, c: string) => {
      await waitFor(() => expect(backend.heard).toEqual([a, b, c]));
    });
  });

  Scenario('mw-q6n8m0.12 AC-1: a turn that went on the chain holds back the turns after it until its record is seen', ({ Given, And, When, Then }) => {
    Given('the backend is up', () => {});
    And('the Talk turn {string} goes on the chain because the backend cannot be reached for it', (_c, text: string) => {
      backend.fate.set(text, 'chain');
    });
    When('he says {string}, {string} and {string} on the Talk line', async (_c, a: string, b: string, c: string) => {
      await say(a, b, c);
    });
    Then('the Mayor has heard only {string}', async (_c, text: string) => {
      await waitFor(async () => expect((await rowFor(text))?.state).toBe('sent'));
      expect(backend.heard).toEqual([text]);
    });
    And('{string} and {string} still show as waiting to go', async (_c, a: string, b: string) => {
      expect((await rowFor(a))?.state).toBe('pending');
      expect((await rowFor(b))?.state).toBe('pending');
    });
    When('the record of {string} comes back from the chain', async (_c, text: string) => {
      const txid = (await rowFor(text))?.txid as string;
      await db.messages.put({ id: `${txid}:0`, txid, vout: 0, seq: 7, class: 'talk', to: '02aa', from: '02bb', ts: 0, ciphertext: '', plaintext: '', direction: 'sent', read: true, thread: 'talk' });
      kickOutbox(true);
    });
    Then('the Mayor heard {string}, {string} and {string}, in that order, once each', async (_c, a: string, b: string, c: string) => {
      await waitFor(() => expect(backend.heard).toEqual([a, b, c]));
    });
  });

  Scenario('mw-q6n8m0.12 AC-1: discarding a refused turn lets the turns after it go', ({ Given, And, When, Then }) => {
    Given('the backend is up', () => {});
    And('the backend refuses the Talk turn {string} for good, saying {string}', (_c, text: string) => {
      backend.fate.set(text, 'refuse');
    });
    When('he says {string}, {string} and {string} on the Talk line', async (_c, a: string, b: string, c: string) => {
      await say(a, b, c);
    });
    Then('the Mayor has heard no turns', async () => {
      await waitFor(async () => expect((await rowFor('turn four'))?.state).toBe('failed'));
      expect(backend.heard).toEqual([]);
    });
    When('he taps Discard on {string}', async (_c, text: string) => {
      await discardRow((await rowFor(text))?.id as number);
    });
    Then('the Mayor heard {string} and {string}, in that order, once each', async (_c, a: string, b: string) => {
      await waitFor(() => expect(backend.heard).toEqual([a, b]));
    });
  });
});
