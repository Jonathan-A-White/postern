// features/steps/outbox-hang.steps.tsx — runs features/outbox-hang.feature (mw-gb92lmo): the real Composer,
// OutboxNote, outbox, deliver and apiFetch against a stubbed global fetch that hangs, then answers; the
// live status reads 'live' (the phone's key polls fine). Only the key, the Mayor's key and that status are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { Composer } from '../../src/cockpit/Composer';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { db } from '../../src/data/db';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', answering: false, posted: 0 }));

vi.mock('../../src/services/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/live')>();
  const live = { ...actual.getLiveState(), status: 'live' as const };
  return { ...actual, useLive: () => live, deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true }) };
});
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

/** Like the browser's fetch: never answers, and rejects with an AbortError once its signal aborts. */
const hangs = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
  });

async function letStorageRun(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

async function pass(ms: number): Promise<void> {
  await act(async () => {
    for (let spent = 0; spent < ms; spent += 1000) {
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - spent));
      await new Promise((resolve) => setImmediate(resolve));
    }
  });
}

const feature = await loadFeature('features/outbox-hang.feature');

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  Scenario('mw-gb92lmo AC-3: online, a message whose first POST hangs is delivered after the timeout without a reload, and the status line clears', ({ Given, And, When, Then }) => {
    Given('the phone reaches the backend, which takes the challenge but never answers the message, and the chain provider never answers either', async () => {
      cleanup();
      vi.useRealTimers();
      await settlePhone();
      forgetOutboxState();
      await Promise.all([db.messages.clear(), db.outbox.clear()]);
      held.answering = false;
      held.posted = 0;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith(chainConfig.providerBaseUrl)) return hangs(init);
          if (isChallengeRequest(url)) return Promise.resolve(challengeResponse());
          if (url.endsWith('/messages')) {
            held.posted += 1;
            if (held.answering) return Promise.resolve(new Response(JSON.stringify({ txid: 'direct:' + 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return hangs(init);
        }),
      );
      render(
        <>
          <OutboxNote />
          <Composer thread={undefined} />
        </>,
      );
    });
    And('he has typed "Is the deploy done?"', () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Is the deploy done?' } });
    });
    When('he taps Send', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await letStorageRun();
    });
    And('2 minutes pass', () => pass(120_000));
    Then('the message "Is the deploy done?" is still pending after a failed try', async () => {
      await letStorageRun();
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'message', state: 'pending' });
      expect(rows[0].attempts).toBeGreaterThanOrEqual(1);
    });
    And('the status line never says "Sending when back online"', () => {
      const line = screen.queryByRole('status', { name: 'Outgoing' });
      expect(line).not.toBeNull();
      expect(line).not.toHaveTextContent('Sending when back online');
    });
    When('the backend answers the message', () => {
      held.answering = true;
    });
    And('2 more minutes pass', () => pass(120_000));
    Then('the message "Is the deploy done?" is sent once without a reload', async () => {
      await letStorageRun();
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'sent' });
      expect(held.posted).toBeGreaterThanOrEqual(2);
    });
    And('the status line says nothing', () => {
      expect(screen.queryByRole('status', { name: 'Outgoing' })).toBeNull();
    });
  });
});
