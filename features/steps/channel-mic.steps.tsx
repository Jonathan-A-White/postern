// features/steps/channel-mic.steps.tsx — runs features/channel-mic.feature (mw-it6qk5.4): a channel's
// composer, its Hold to talk bar and the real hold on bsv-kit's honest microphone (bsv-kit/testing/mic): its
// recogniser opens after a moment and hears a recorded clip word by word, its getUserMedia and MediaRecorder
// behave like Android Chrome's. Nothing of the hold is doubled: the speech recogniser, the voice recorder and
// the microphone are the package's own. Only the delivery is a double.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { installMic, clips, type MicFake } from 'bsv-kit/testing/mic';
import { Composer } from '../../src/cockpit/Composer';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import { db } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { forgetSilentInputs } from 'bsv-kit/composer';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import type { Attachment } from '../../src/services/threads';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 8000 });

const doubles = vi.hoisted(() => ({
  delivered: [] as { text: string; attachments?: Attachment[]; attachment?: Attachment }[],
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

let mic: MicFake | null = null;

afterAll(() => {
  cleanup();
  lock();
  mic?.uninstall();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/channel-mic.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    dismissAllToasts();
    mic?.uninstall();
    mic = null;
    // jsdom has no object URLs; the previews only need a string
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
    forgetSilentInputs();
    setKey(doubles.key);
    doubles.delivered = [];
    forgetOutboxState();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.outbox.clear()]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (isChallengeRequest(url)) return challengeResponse();
        // a voice note, when the hold records one, is uploaded as a blob
        if (url.endsWith('/blobs')) return new Response(JSON.stringify({ hash: 'ab'.repeat(32), size: 100 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  Scenario("AC-1: a channel's Hold to talk on the honest microphone hears the clip and sends its words, with no capture of the page's own beside the recogniser (mw-f7gmps.2)", ({ Given, And, When, Then }) => {
    Given("the phone's microphone is bsv-kit's honest one, hearing {string}", (_c, words: string) => {
      mic = installMic(window, { clip: clips.english });
      expect(mic.clip.transcript).toBe(words);
    });
    And("a channel's composer is open", () => {
      render(
        <>
          <Composer thread={undefined} />
          <ToastHost />
        </>,
      );
    });
    When('he taps the mic beside Send', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
      await screen.findByRole('button', { name: 'Hold to talk' });
    });
    And('he presses and holds the bar until the recogniser has heard the whole clip', async () => {
      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Hold to talk' }));
      await screen.findByRole('button', { name: 'Release to send' });
      // the clip plays in real time: the recogniser shows each word as it ends, the last one at the clip's end
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(mic!.clip.transcript), { timeout: 8000 });
    });
    Then('the live transcript reads {string}', (_c, words: string) => {
      expect(screen.getByTestId('live-transcript')).toHaveTextContent(words);
    });
    And('the page holds no microphone capture and has made no voice recorder', () => {
      // On Android the recogniser opens the microphone itself, and a capture the page holds beside it takes the
      // microphone from it: the recogniser then hears silence (the Talk line's hold opens none).
      expect(mic!.streams.filter((stream) => stream.active)).toEqual([]);
      expect(mic!.recorders).toEqual([]);
    });
    When('he lets go of the bar', async () => {
      fireEvent.pointerUp(screen.getByRole('button', { name: 'Release to send' }), { clientX: 10, clientY: 10 });
      await act(async () => settledOutbox());
    });
    Then('one message is delivered with the words {string}', async (_c, words: string) => {
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      expect(doubles.delivered[0].text).toBe(words);
    });
  });
});
