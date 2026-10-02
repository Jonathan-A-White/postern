// features/steps/send-timeout.steps.tsx — runs features/send-timeout.feature
// (mw-t64a3.7): the real Composer, sendToThread, deliver and apiFetch against a
// stubbed global fetch that answers, or never does; only the key and the
// Mayor's key are supplied by a double.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { Composer } from '../../src/cockpit/Composer';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { API_TIMEOUT_MS } from '../../src/services/apiAuth';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '' }));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

const never = () => new Promise<Response>(() => {});
/** Like the browser's fetch: rejects with an AbortError as soon as its signal aborts. */
const neverUntilAborted = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
  });
let posted = 0;

function messageAccepted(): Response {
  return new Response(JSON.stringify({ txid: 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function fresh(answer: (url: string, init?: RequestInit) => Promise<Response> | Response, fakeTimers: boolean): Promise<void> {
  cleanup();
  dismissAllToasts();
  vi.useRealTimers();
  vi.restoreAllMocks();
  forgetOutboxState();
  await Promise.all([db.messages.clear(), db.outbox.clear()]);
  posted = 0;
  if (fakeTimers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'fetch',
    // Not async: a real fetch's abort rejection must not be delayed by the stub's own wrapping promise.
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/messages')) posted += 1;
      // The chain road for a typed post (docs/protocol.md §21) is out of reach too: these scenarios are about the backend not answering.
      if (url.startsWith(chainConfig.providerBaseUrl)) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(answer(url, init));
    }),
  );
  render(
    <>
      <Composer thread={undefined} />
      <ToastHost />
    </>,
  );
}

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } });
}

async function tapSend(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  if (!vi.isFakeTimers()) return;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Lets the phone's own storage (real macrotasks, which the fake timers leave alone) do what it has been asked. */
async function letStorageRun(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

async function pass30Seconds(): Promise<void> {
  // The sender reads the outbox before it posts: let it get to the wait before the clock moves.
  await letStorageRun();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
  });
  await letStorageRun();
}

const feature = await loadFeature('features/send-timeout.feature');

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const waiting = async (words: string) => {
    await act(async () => settledOutbox());
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'message', state: 'pending', attempts: 1 });
    expect(JSON.stringify(rows[0].payload)).toContain(words);
  };

  Scenario('AC-1: a POST that never answers does not hold the composer; the message stays pending and is tried again', ({ Given, And, When, Then }) => {
    Given('the backend takes the challenge but never answers the message', () =>
      fresh((url) => (isChallengeRequest(url) ? challengeResponse() : never()), true),
    );
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    Then('the composer is free again without any time passing', async () => {
      await letStorageRun();
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    });
    And('the box is empty', () => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    });
    When('30 seconds pass', pass30Seconds);
    Then('the message "Is the deploy done?" is still in the outbox, pending, after a failed try', () => waiting('Is the deploy done?'));
    And('he is told nothing', () => {
      expect(screen.queryByText(/May have gone|Not sent|Could not/)).toBeNull();
    });
  });

  Scenario('mw-t64a3.14: a send whose fetch is aborted at the timeout is tried again, and the abort text is never shown', ({ Given, And, When, Then }) => {
    Given('the backend takes the challenge and the browser aborts the message request at the timeout', () =>
      fresh((url, init) => (isChallengeRequest(url) ? challengeResponse() : neverUntilAborted(init)), true),
    );
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    And('30 seconds pass', pass30Seconds);
    Then('the message "Is the deploy done?" is still in the outbox, pending, after a failed try', () => waiting('Is the deploy done?'));
    And('he is never shown "signal is aborted without reason"', () => {
      expect(screen.queryByText(/aborted/)).toBeNull();
    });
  });

  Scenario('AC-2: a challenge that never answers leaves the message pending', ({ Given, And, When, Then }) => {
    Given('the backend never answers the challenge', () => fresh(() => never(), true));
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    And('30 seconds pass', pass30Seconds);
    Then('the message "Is the deploy done?" is still in the outbox, pending, after a failed try', () => waiting('Is the deploy done?'));
    And('he is told nothing', () => {
      expect(screen.queryByText(/May have gone|Not sent|Could not/)).toBeNull();
    });
    And('nothing was posted to the backend', () => {
      expect(posted).toBe(0);
    });
  });

  Scenario('AC-3: a local cache write that never settles does not hold the spinner', ({ Given, And, When, Then }) => {
    Given('the backend takes the message and answers 200', () =>
      fresh((url) => (isChallengeRequest(url) ? challengeResponse() : messageAccepted()), false),
    );
    And('the local message store never finishes a write', () => {
      vi.spyOn(messagesRepo, 'put').mockImplementation(() => new Promise<void>(() => {}));
    });
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    Then('Send is ready again without any time passing', async () => {
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Message' })).toHaveValue(''));
      await waitFor(() => expect(messagesRepo.put).toHaveBeenCalled());
    });
    And('the box is empty', () => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    });
  });

  Scenario('AC-4: the happy path clears the text', ({ Given, And, When, Then }) => {
    Given('the backend takes the message and answers 200', () =>
      fresh((url) => (isChallengeRequest(url) ? challengeResponse() : messageAccepted()), false),
    );
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    Then('Send is ready again without any time passing', async () => {
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    });
    And('the box is empty', () => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    });
    And('one message was posted to the backend', async () => {
      await waitFor(() => expect(posted).toBe(1));
    });
  });
});
