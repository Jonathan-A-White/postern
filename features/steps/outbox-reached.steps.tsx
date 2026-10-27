// features/steps/outbox-reached.steps.tsx — runs features/outbox-reached.feature (mw-j4usch0): the real live loop,
// sender, deliver, apiFetch and status line (OutboxNote); fetch, /api/me, the message sync and the chain are the
// doubles, and every round trip takes a phone's time, so the sender's storage reads finish before the network answers.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chain, setChain, type Chain } from '../../src/chain';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { db } from '../../src/data/db';
import { retryDelay } from '../../src/model/outbox';
import { forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const net = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', answers: false, probes: 0, posted: 0, streams: 0 }));

vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => net.key,
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: net.mayorKey, network: 'testnet', features: ['events', 'view', 'direct'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: net.mayorKey, offered: undefined })),
}));
vi.mock('../../src/services/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/events')>()),
  syncMessagesAndEvents: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (!net.answers) throw new TypeError('Failed to fetch');
    return { applied: 0, refetched: false };
  }),
}));
vi.mock('../../src/services/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/view')>()),
  refreshView: vi.fn(async () => 'unchanged' as const),
}));

net.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();
const realChain: Chain = chain;
const chainSends = vi.fn(async () => {
  throw new Error('WhatsOnChain could not take it.');
});
let rowId = 0;
let returnedAt = 0;
let sentAt: number | undefined;
let stopOutbox: (() => void) | undefined;

async function pass(ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(250, ms - spent));
      for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
    });
    if (sentAt === undefined && (await db.outbox.get(rowId))?.state === 'sent') sentAt = Date.now();
  }
}

afterAll(async () => {
  stopOutbox?.();
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setChain(realChain);
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
});

const feature = await loadFeature('features/outbox-reached.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-5: the stream drops and reconnects in a loop, probes succeed, and his message goes within one retry without a reload', ({ Given, And, Then, When }) => {
    Given('the event stream drops every time it opens and nothing the backend is asked is answered', async () => {
      cleanup();
      await settlePhone();
      forgetOutboxState();
      await db.outbox.clear();
      setChain({ ...realChain, sendText: chainSends, read: vi.fn(async () => ({ rows: [], events: [], failed: 0 })) } as Chain);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (isChallengeRequest(url)) return challengeResponse();
          if (url.endsWith('/events')) {
            net.streams += 1;
            throw new TypeError('Failed to fetch');
          }
          if (!net.answers) throw new TypeError('Failed to fetch');
          if (url.includes('/view?why=probe')) {
            net.probes += 1;
            return new Response(null, { status: 304 });
          }
          if (url.endsWith('/messages')) {
            net.posted += 1;
            return new Response(JSON.stringify({ txid: 'direct:' + 'cd'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return new Response('{}', { status: 200 });
        }),
      );
      startLive(net.key);
      await pass(6_000);
      expect(getLiveState().status).toBe('offline');
    });
    And('his message "Is the deploy done?" has failed six tries and waits a minute for the next', async () => {
      rowId = (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'Is the deploy done?', files: [] }, created: Date.now(), attempts: 6, state: 'pending', nextAt: Date.now() + retryDelay(6) })) as number;
      stopOutbox = startOutbox();
      render(<OutboxNote />);
      await pass(1_000);
    });
    Then('the status line says "Sending when back online"', () => {
      expect(screen.getByRole('status', { name: 'Outgoing' })).toHaveTextContent('Sending when back online');
    });
    When('the backend answers again, the stream still dropping, and he comes back to the app', async () => {
      net.answers = true;
      net.posted = 0;
      chainSends.mockClear();
      const streamsBefore = net.streams;
      returnedAt = Date.now();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await pass(5_000);
      await act(async () => settledOutbox());
      // The stream was tried again, and dropped again.
      expect(net.streams).toBeGreaterThan(streamsBefore);
      expect(getLiveState().status).not.toBe('live');
    });
    Then('the probe the return makes is answered', () => {
      expect(net.probes).toBeGreaterThan(0);
    });
    And('his message is posted to the backend within one retry, without a reload', async () => {
      expect(net.posted).toBe(1);
      expect(await db.outbox.get(rowId)).toMatchObject({ state: 'sent' });
      expect(sentAt).toBeDefined();
      expect((sentAt as number) - returnedAt).toBeLessThan(retryDelay(7));
    });
    And('it never went to WhatsOnChain', () => {
      expect(chainSends).not.toHaveBeenCalled();
    });
    And('the status line clears', () => {
      expect(screen.queryByRole('status', { name: 'Outgoing' })).toBeNull();
    });
  });
});
