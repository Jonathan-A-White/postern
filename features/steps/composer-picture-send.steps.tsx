// features/steps/composer-picture-send.steps.tsx — runs features/composer-picture-send.feature
// (mw-jtzpw0.10): the real Composer, sendToThread, outbox and uploadAttachment (against a stubbed
// fetch); the microphone and the delivery are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { Composer } from '../../src/cockpit/Composer';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import { db } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import type { Attachment } from '../../src/services/threads';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const doubles = vi.hoisted(() => ({
  delivered: [] as { text: string; attachments?: Attachment[]; attachment?: Attachment }[],
  uploads: 0,
  key: new Uint8Array(32).fill(7),
  mayorKey: '',
}));

doubles.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: doubles.key, mayorKey: doubles.mayorKey, direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => doubles.key,
}));
vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverThreaded: async (message: { text: string; attachments?: Attachment[]; attachment?: Attachment }) => {
    doubles.delivered.push(message);
    return { txid: 'ef'.repeat(32), channel: 'direct' };
  },
}));

// The browser's speech recogniser, as a fake that opens its mic.
class FakeRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/composer-picture-send.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    dismissAllToasts();
    vi.restoreAllMocks();
    // jsdom has no object URLs; the previews only need a string
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
    setKey(doubles.key);
    doubles.delivered = [];
    doubles.uploads = 0;
    forgetOutboxState();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.outbox.clear()]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        if (url.endsWith('/blobs')) {
          doubles.uploads += 1;
          return new Response(JSON.stringify({ hash: String(doubles.uploads).padStart(2, '0').repeat(32), size: 100 + doubles.uploads }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  const open = () => {
    render(
      <>
        <Composer thread={undefined} />
        <ToastHost />
      </>,
    );
  };
  const attachPicture = async (_c: unknown, name: string) => {
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    await act(async () => fireEvent.change(input, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })] } }));
    await screen.findByLabelText(`Remove ${name}`);
  };
  const tapMic = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    await screen.findByRole('button', { name: 'Hold to talk' });
  };
  const noArrow = () => {
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  };

  Scenario('AC-1: with the bar out and a picture attached, a Send arrow stands beside Hold to talk', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    Then('the Hold to talk bar and a Send arrow are both there, the arrow after the bar', async () => {
      const bar = screen.getByRole('button', { name: 'Hold to talk' });
      const arrow = await screen.findByRole('button', { name: 'Send' });
      expect(arrow).toBeEnabled();
      expect(bar.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(bar.parentElement).toBe(arrow.parentElement);
    });
  });

  Scenario('AC-2: with the bar out and nothing attached there is no Send arrow', ({ Given, When, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic', tapMic);
    Then('there is no Send arrow', noArrow);
  });

  Scenario('AC-3: one tap on the Send arrow sends the picture with no text', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    And('he taps the Send arrow', async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
      await act(async () => settledOutbox());
    });
    Then('one message is delivered with one attachment and no text', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      const [message] = doubles.delivered;
      expect(message.text).toBe('');
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments?.[0]).toMatchObject({ mime: 'image/png' });
    });
    And('the picture is no longer attached and the Send arrow is gone', async () => {
      await waitFor(() => expect(screen.queryByLabelText('Remove photo.png')).toBeNull());
      noArrow();
    });
  });

  Scenario('AC-4: removing the picture takes the Send arrow away', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    And('he removes the picture {string}', (_c, name: string) => {
      fireEvent.click(screen.getByLabelText(`Remove ${name}`));
    });
    Then('there is no Send arrow', noArrow);
  });

  Scenario('AC-5: while the bar is held the Send arrow waits', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    And('he presses and holds the bar', async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
      await screen.findByRole('button', { name: 'Release to send' });
    });
    Then('the Send arrow is disabled', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });
  });
});
