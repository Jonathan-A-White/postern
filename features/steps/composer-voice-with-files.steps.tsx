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
  const record = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await screen.findByText(/Voice note 0:03/);
  };
  const tapSend = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => settledOutbox());
  };
  const offersSendOnly = () => {
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
  };

  Scenario('AC-1: with a picture and no words the mic stays beside Send', ({ Given, When, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    Then('the composer offers both Send and Record a voice note', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeEnabled();
    });
  });

  Scenario('AC-2: with words typed the composer offers Send only', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he types {string}', (_c, words: string) => {
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: words } });
    });
    Then('the composer offers Send and no Record a voice note', offersSendOnly);
  });

  Scenario('AC-3: a recorded voice note joins the picture and the mic goes', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he records a voice note', record);
    Then('the composer offers Send and no Record a voice note', offersSendOnly);
  });

  Scenario('AC-4: a picture and a voice note go out as one message carrying both files', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he records a voice note', record);
    And('he taps Send', tapSend);
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
