// features/steps/api-after-outage.steps.ts — runs features/api-after-outage.feature
// (mw-gq6.276): the real syncMessages and apiFetch against a fetch double. AC-2's backend
// sends a 200 and part of its body, then nothing (a link that drops large packets: the
// headers come, the rest never does); AC-3's issues single-use nonces and refuses any it
// did not issue or has seen before, as server/internal/auth/nonce.go does.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { apiFetch } from '../../src/services/apiAuth';
import { syncMessages } from '../../src/services/inbox';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const ME = PrivateKey.fromHex('44'.repeat(32));
const KEY = new Uint8Array(Utils.toArray(ME.toHex(), 'hex'));
const CURSOR = 'messages-cursor';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A 200 whose body sends its first bytes and then never another. */
function stalledResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"records":[{"seq":15679,'));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterAll(() => {
  vi.useRealTimers();
});

const feature = await loadFeature('features/api-after-outage.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-gq6.276 AC-2: a messages fetch whose body stops coming gives up, and the next good fetch advances the cursor', ({ Given, When, And, Then }) => {
    const asked: string[] = [];
    let first: { settled: boolean; error?: unknown } = { settled: false };

    Given('the messages cursor stands at 15678', async () => {
      await db.settings.clear();
      await settingsRepo.set(CURSOR, 15678);
    });
    When('a messages fetch is answered 200 and its body stops halfway', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        asked.push(url);
        return stalledResponse();
      });
      first = { settled: false };
      void syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: KEY, fetchImpl }).then(
        () => (first = { settled: true }),
        (error: unknown) => (first = { settled: true, error }),
      );
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    });
    And('31 seconds pass with no more of it', async () => {
      await vi.advanceTimersByTimeAsync(31_000);
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
      vi.useRealTimers();
    });
    Then('that sync has given up with "The backend did not answer in time."', () => {
      expect(first.settled).toBe(true);
      expect(first.error).toBeInstanceOf(Error);
      expect((first.error as Error).message).toBe('The backend did not answer in time.');
    });
    And('the messages cursor still stands at 15678', async () => {
      expect(await settingsRepo.get(CURSOR)).toBe(15678);
    });
    When('the next messages fetch is answered whole, naming next 16433', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        asked.push(url);
        return json({ records: [], next: 16433 });
      });
      await syncMessages({ publicKeyHex: ME.toPublicKey().toString(), unlockedKey: KEY, fetchImpl });
    });
    Then('the messages cursor stands at 16433', async () => {
      expect(await settingsRepo.get(CURSOR)).toBe(16433);
    });
    And('the fetch asked for since=15678', () => {
      expect(asked).toHaveLength(2);
      for (const url of asked) expect(url).toMatch(/\/messages\?since=15678&limit=200$/);
    });
  });

  Scenario('mw-gq6.276 AC-3: concurrent calls each sign a nonce of their own and none is refused', ({ Given, When, Then, And }) => {
    const issued = new Set<string>();
    const used: string[] = [];
    let statuses: number[] = [];
    let fetchImpl: typeof fetch;

    Given('a backend whose nonces are single-use', () => {
      let n = 0;
      fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isChallengeRequest(url)) {
          // Answered out of order, as a busy link does: later challenges can come back first.
          const nonce = (++n).toString(16).padStart(64, '0');
          issued.add(nonce);
          await new Promise((resolve) => setTimeout(resolve, (8 - n) % 4));
          return challengeResponse(nonce);
        }
        const header = new Headers(init?.headers).get('Authorization') ?? '';
        const nonce = header.replace(/^Postern /, '').split(':')[1] ?? '';
        if (!issued.has(nonce) || used.includes(nonce)) return json({ error: 'nonce is missing, expired, or already used', reason: 'nonce' }, 401);
        used.push(nonce);
        return json({ ok: true });
      }) as typeof fetch;
    });
    When('8 calls go to it at once', async () => {
      const calls = Array.from({ length: 8 }, (_, i) =>
        apiFetch(i % 2 ? `/blobs/${i}` : '/blobs', i % 2 ? undefined : { method: 'POST', body: new Uint8Array([i]) }, { unlockedKey: KEY, fetchImpl }),
      );
      statuses = (await Promise.all(calls)).map((response) => response.status);
    });
    Then('every call is answered 200', () => {
      expect(statuses).toEqual(Array(8).fill(200));
    });
    And('each call was signed with its own nonce, one the backend issued', () => {
      expect(used).toHaveLength(8);
      expect(new Set(used).size).toBe(8);
      expect(issued.size).toBe(8);
      for (const nonce of used) expect(issued.has(nonce)).toBe(true);
    });
  });
});
