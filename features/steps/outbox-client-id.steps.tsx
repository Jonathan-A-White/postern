// features/steps/outbox-client-id.steps.tsx — runs features/outbox-client-id.feature (mw-jrx0s.23):
// the real sender and the real deliver() against a backend double that dedupes on the client id
// each outbox row carries, as server/internal/api/direct.go does, and that can lose its reply.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { outboxRepo } from '../../src/data/repositories';
import { enqueue, forgetOutboxState, kickOutbox, settledOutbox } from '../../src/services/outbox';
import { settledWrites } from '../../src/services/deliver';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();

const backend = vi.hoisted(() => ({
  loseFirstReply: false,
  posts: 0,
  stored: [] as string[],
  byClientId: new Map<string, string>(),
  answered: [] as string[],
  clientIds: [] as Array<string | undefined>,
}));

function backendFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (!url.endsWith('/messages')) throw new Error(`unexpected fetch: ${url}`);
    const body = JSON.parse(String(init?.body)) as { scriptHex: string; clientId?: string };
    backend.posts += 1;
    backend.clientIds.push(body.clientId);
    const seen = body.clientId ? backend.byClientId.get(body.clientId) : undefined;
    let txid = seen;
    if (!txid) {
      txid = `direct:${backend.stored.length + 1}`;
      backend.stored.push(txid);
      if (body.clientId) backend.byClientId.set(body.clientId, txid);
    }
    if (backend.loseFirstReply && backend.posts === 1) throw new TypeError('Failed to fetch');
    backend.answered.push(txid);
    return new Response(JSON.stringify({ txid, seq: backend.stored.length }), { status: seen ? 200 : 201 });
  }) as unknown as typeof fetch;
}

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: KEY, mayorKey: MAYOR, direct: true, fetchImpl: backendFetch() }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => KEY,
}));

let firstClientId: string | undefined;

async function fresh(): Promise<void> {
  forgetOutboxState();
  backend.loseFirstReply = false;
  backend.posts = 0;
  backend.stored = [];
  backend.byClientId = new Map();
  backend.answered = [];
  backend.clientIds = [];
  firstClientId = undefined;
  await Promise.all([db.messages.clear(), db.outbox.clear()]);
}

const tap = async (bead: string) => {
  await enqueue({ kind: 'action', bead, payload: { action: { action: 'release', bead } } });
  await settledOutbox();
};

const wake = async () => {
  kickOutbox(true);
  await settledOutbox();
  await settledWrites();
};

afterAll(async () => {
  forgetOutboxState();
  await settledWrites();
});

const feature = await loadFeature('features/outbox-client-id.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-jrx0s.23: a retry after a lost reply reaches the backend twice but is stored once under one txid', ({ Given, When, And, Then }) => {
    Given('the backend takes the first post but its reply is lost', () => {
      backend.loseFirstReply = true;
    });
    When('he taps {string} on bead {string}', async (_c, _label: string, bead: string) => {
      await tap(bead);
      expect((await outboxRepo.all())[0]).toMatchObject({ state: 'pending', attempts: 1 });
    });
    And('the sender is woken', wake);
    Then('the backend was posted to {int} times', (_c, n: number) => {
      expect(backend.posts).toBe(n);
    });
    And('the backend stored {int} record', (_c, n: number) => {
      expect(backend.stored).toHaveLength(n);
    });
    And('both posts were answered with the same txid', () => {
      // the first reply was lost on the wire; the backend would have said the same thing
      expect(backend.clientIds[0]).toBeTruthy();
      expect(backend.clientIds[1]).toBe(backend.clientIds[0]);
      expect(backend.answered).toEqual([backend.stored[0]]);
    });
    And('the outbox row is sent with that txid', async () => {
      expect((await outboxRepo.all())[0]).toMatchObject({ state: 'sent', txid: backend.stored[0] });
    });
  });

  Scenario('mw-jrx0s.23: two taps with identical content are two records', ({ Given, When, Then, And }) => {
    Given('the backend answers every post', () => {
      backend.loseFirstReply = false;
    });
    When('he taps {string} on bead {string} twice', async (_c, _label: string, bead: string) => {
      await tap(bead);
      await tap(bead);
      await settledWrites();
    });
    Then('the backend stored {int} records', (_c, n: number) => {
      expect(backend.stored).toHaveLength(n);
    });
    And('the two outbox rows carry different client ids', async () => {
      const ids = (await outboxRepo.all()).map((row) => row.clientId);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
      expect(ids[1]).toMatch(/^[0-9a-f]{32}$/);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  Scenario('mw-jrx0s.23: the client id is in the row on the phone and survives a restart', ({ Given, When, And, Then }) => {
    Given('the backend takes the first post but its reply is lost', () => {
      backend.loseFirstReply = true;
    });
    When('he taps {string} on bead {string}', async (_c, _label: string, bead: string) => {
      await tap(bead);
      firstClientId = (await outboxRepo.all())[0].clientId;
      expect(firstClientId).toMatch(/^[0-9a-f]{32}$/);
    });
    And('the app is reloaded', () => {
      forgetOutboxState();
    });
    And('the sender is woken', wake);
    Then('the outbox row still carries the client id it had when first tried', async () => {
      expect((await outboxRepo.all())[0].clientId).toBe(firstClientId);
      expect(backend.clientIds).toEqual([firstClientId, firstClientId]);
    });
    And('the backend stored {int} record', (_c, n: number) => {
      expect(backend.stored).toHaveLength(n);
    });
  });
});
