// features/steps/composer-voice-with-files.steps.tsx — runs features/composer-voice-with-files.feature
// (mw-q6n8m0.1): the real Composer, sendToThread, outbox and uploadAttachment (against a stubbed
// fetch); the microphone (services/recorder) and the delivery are doubles.
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
  delivered: [] as { attachments?: Attachment[]; attachment?: Attachment }[],
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
  deliverThreaded: async (message: { attachments?: Attachment[]; attachment?: Attachment }) => {
    doubles.delivered.push(message);
    return { txid: 'ef'.repeat(32), channel: 'direct' };
  },
}));
vi.mock('../../src/services/recorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/recorder')>()),
  canRecord: () => true,
  VoiceRecorder: class {
    async start() {}
    async stop() {
      return { blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), mime: 'audio/webm', durationMs: 3000 };
    }
    cancel() {}
  },
}));

// The browser's speech recogniser, as a fake that opens its mic and hears what a step says.
let recognizers: FakeRecognizer[] = [];
class FakeRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  start() {
    this.started = true;
    recognizers.push(this);
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

function attachments(): Attachment[] {
  expect(doubles.delivered).toHaveLength(1);
  const [message] = doubles.delivered;
  return message.attachments ?? (message.attachment ? [message.attachment] : []);
}

const feature = await loadFeature('features/composer-voice-with-files.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    dismissAllToasts();
    vi.restoreAllMocks();
    // jsdom has no object URLs; the previews only need a string
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    recognizers = [];
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
  const holdSayAndLetGo = async (_c: unknown, words: string) => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
    await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
    await screen.findByRole('button', { name: 'Release to send' });
    act(() => {
      recognizers.at(-1)?.onresult?.({ results: [[{ transcript: words }]] });
    });
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Release to send' }));
    await act(async () => settledOutbox());
  };
  const offersSendOnly = () => {
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Speak a message' })).toBeNull();
  };

  Scenario('AC-1: with a picture and no words the mic stays beside Send', ({ Given, When, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    Then('the composer offers both Send and Speak a message', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Speak a message' })).toBeEnabled();
    });
  });

  Scenario('AC-2: with words typed the composer offers Send only', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he types {string}', (_c, words: string) => {
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: words } });
    });
    Then('the composer offers Send and no Speak a message', offersSendOnly);
  });

  Scenario('AC-3: tapping the mic with a picture attached brings out the bar and keeps the picture', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    Then('the Hold to talk bar is out and the picture {string} is still attached', (_c, name: string) => {
      expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeEnabled();
      expect(screen.getByLabelText(`Remove ${name}`)).toBeInTheDocument();
    });
  });

  Scenario('AC-4: a picture and a voice note go out as one message carrying both files', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic', tapMic);
    And('he holds the bar, says {string} and lets go', holdSayAndLetGo);
    Then('one message is delivered with two attachments', async () => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      expect(attachments()).toHaveLength(2);
    });
    And('attachment 1 has mime {string}', (_c, mime: string) => {
      expect(attachments()[0]).toMatchObject({ mime });
    });
    And('attachment 2 has mime {string}', (_c, mime: string) => {
      expect(attachments()[1]).toMatchObject({ mime });
    });
  });
});
