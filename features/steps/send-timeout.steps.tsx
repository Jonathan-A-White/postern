// features/steps/send-timeout.steps.tsx — runs features/send-timeout.feature
// (mw-t64a3.7): the real Composer, sendToThread, deliver and apiFetch against a
// stubbed global fetch that answers, or never does; only the key and the
// Mayor's key are supplied by a double.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { Composer } from '../../src/cockpit/Composer';
import { ToastHost } from '../../src/ui/toast';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { API_TIMEOUT_MS } from '../../src/services/apiAuth';
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
let posted = 0;

function messageAccepted(): Response {
  return new Response(JSON.stringify({ txid: 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function fresh(answer: (url: string) => Promise<Response> | Response, fakeTimers: boolean): Promise<void> {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.messages.clear();
  posted = 0;
  if (fakeTimers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/messages')) posted += 1;
      return answer(url);
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

async function pass30Seconds(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
  });
}

const feature = await loadFeature('features/send-timeout.feature');

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  Scenario('AC-1: a POST that never answers ends the spinner and says the message may have gone', ({ Given, And, When, Then }) => {
    Given('the backend takes the challenge but never answers the message', () =>
      fresh((url) => (isChallengeRequest(url) ? challengeResponse() : never()), true),
    );
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    Then('Send is busy', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });
    When('30 seconds pass', pass30Seconds);
    Then('Send is ready again', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });
    And('he is told "May have gone: check the thread before sending again"', () => {
      expect(screen.getByText('May have gone: check the thread before sending again')).toBeInTheDocument();
      expect(screen.queryByText(/Not sent/)).toBeNull();
    });
    And('the text "Is the deploy done?" is still in the box', () => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Is the deploy done?');
    });
  });

  Scenario('AC-2: a challenge that never answers says the message was not sent', ({ Given, And, When, Then }) => {
    Given('the backend never answers the challenge', () => fresh(() => never(), true));
    And('he has typed "Is the deploy done?"', () => type('Is the deploy done?'));
    When('he taps Send', tapSend);
    And('30 seconds pass', pass30Seconds);
    Then('Send is ready again', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });
    And('he is told "Not sent: try again"', () => {
      expect(screen.getByText('Not sent: try again')).toBeInTheDocument();
      expect(posted).toBe(0);
    });
    And('the text "Is the deploy done?" is still in the box', () => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Is the deploy done?');
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
      expect(messagesRepo.put).toHaveBeenCalled();
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
    And('one message was posted to the backend', () => {
      expect(posted).toBe(1);
    });
  });
});
