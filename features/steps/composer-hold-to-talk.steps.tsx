// features/steps/composer-hold-to-talk.steps.tsx — runs features/composer-hold-to-talk.feature
// (mw-q6n8m0.3): the real Composer, HoldToTalkBar, the hold hook, sendToThread, the outbox and
// uploadAttachment (against a stubbed fetch); the browser's speech recogniser, the voice recorder
// and the delivery are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { Composer } from '../../src/cockpit/Composer';
import { setPendingShare } from '../../src/cockpit/shareInbox';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import { db } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { forgetSilentInputs } from '../../src/services/micInput';
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
  processLocally = false;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  started = false;
  startedWith: unknown = undefined;
  start(track?: unknown) {
    this.started = true;
    this.startedWith = track;
    recognizers.push(this);
    queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
}

function installBrowser(): void {
  recognizers = [];
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer;
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
}

/** The phone's audio inputs (mw-f7gmps.1): these are listed, and opening one by its id gives a track named after it. */
const opened: (string | undefined)[] = [];
function setInputs(inputs: { deviceId: string; label: string }[]): void {
  opened.length = 0;
  const mediaDevices = {
    enumerateDevices: () => Promise.resolve(inputs.map((input) => ({ ...input, kind: 'audioinput' }))),
    getUserMedia: (constraints: { audio: { deviceId?: { exact: string } } | boolean }) => {
      const wanted = typeof constraints.audio === 'object' ? constraints.audio.deviceId?.exact : undefined;
      opened.push(wanted);
      const track = { label: inputs.find((input) => input.deviceId === wanted)?.label ?? 'default', stop: () => {}, clone: () => ({ ...track }) };
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] });
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true, writable: true });
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hear = (text: string) =>
  act(() => {
    recognizers.at(-1)?.onresult?.({ results: [[{ transcript: text }]] });
  });

const bar = () => screen.getByRole('button', { name: /^(Hold to talk|Release to send|Let go to drop|Starting the mic…)$/ });

/** jsdom has no layout: the bar is 300 x 96 at the origin, so (10, 10) is on it and (600, 10) is off it. */
const ON = { clientX: 10, clientY: 10 };
const OFF = { clientX: 600, clientY: 10 };
function giveTheBarAShape() {
  vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 96, width: 300, height: 96, x: 0, y: 0, toJSON: () => ({}) });
}

const feature = await loadFeature('features/composer-hold-to-talk.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    dismissAllToasts();
    vi.restoreAllMocks();
    // jsdom has no object URLs; the previews only need a string
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    installBrowser();
    forgetSilentInputs();
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
  const press = async () => {
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Hold to talk' }));
    await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
    await screen.findByRole('button', { name: 'Release to send' });
    giveTheBarAShape();
  };
  const holdSayAndLetGo = async (_c: unknown, words: string) => {
    await press();
    await hear(words);
    fireEvent.pointerUp(bar(), ON);
    await act(async () => settledOutbox());
  };
  const oneMessageWith = async (_c: unknown, words: string) => {
    await waitFor(() => expect(doubles.delivered).toHaveLength(1));
    expect(doubles.delivered[0].text).toBe(words);
  };
  const files = (): Attachment[] => {
    const [message] = doubles.delivered;
    return message.attachments ?? (message.attachment ? [message.attachment] : []);
  };
  const barIsThere = () => expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeEnabled();
  const nothingDelivered = async () => {
    await act(async () => settledOutbox());
    expect(doubles.delivered).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  };

  Scenario('AC-1: tapping the mic opens the hold-to-talk bar', ({ Given, When, Then, And }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    Then('the Hold to talk bar is there', barIsThere);
    And('the text box is gone', () => {
      expect(screen.queryByLabelText('Message')).toBeNull();
    });
  });

  Scenario('AC-2: while he holds the bar his words stream on the screen', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he presses and holds the bar', press);
    And('the recogniser hears {string}', async (_c, words: string) => {
      await hear(words);
    });
    Then('the live transcript reads {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
    });
    And('the bar says {string}', (_c, label: string) => {
      expect(bar()).toHaveTextContent(label);
    });
  });

  Scenario('AC-3: letting go sends one message with the words and the voice note', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he holds the bar and says {string} and lets go', holdSayAndLetGo);
    Then('one message is delivered with the words {string}', oneMessageWith);
    And('the message carries one attachment of mime {string}', (_c, mime: string) => {
      expect(files()).toHaveLength(1);
      expect(files()[0]).toMatchObject({ mime });
    });
  });

  Scenario('AC-4: a picture already attached goes in the same message', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he attaches the picture {string}', attachPicture);
    And('he taps the mic beside Send', tapMic);
    And('he holds the bar and says {string} and lets go', holdSayAndLetGo);
    Then('one message is delivered with the words {string}', oneMessageWith);
    And('the message carries {int} attachments', (_c, count: number) => {
      expect(files()).toHaveLength(count);
    });
    And('attachment 1 has mime {string}', (_c, mime: string) => {
      expect(files()[0]).toMatchObject({ mime });
    });
    And('attachment 2 has mime {string}', (_c, mime: string) => {
      expect(files()[1]).toMatchObject({ mime });
    });
  });

  Scenario('AC-5: sliding off the bar says Let go to drop and nothing is sent', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he presses and holds the bar', press);
    And('the recogniser hears {string}', async (_c, words: string) => {
      await hear(words);
    });
    And('he slides his finger off the bar', () => {
      fireEvent.pointerMove(bar(), OFF);
    });
    Then('the bar says {string}', async (_c, label: string) => {
      await waitFor(() => expect(bar()).toHaveTextContent(label));
    });
    When('he lets go off the bar', async () => {
      fireEvent.pointerUp(bar(), OFF);
      await act(async () => settledOutbox());
    });
    Then('nothing is delivered', nothingDelivered);
    And('the Hold to talk bar is there', barIsThere);
  });

  Scenario('AC-6: sliding back onto the bar before letting go still sends', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he presses and holds the bar', press);
    And('the recogniser hears {string}', async (_c, words: string) => {
      await hear(words);
    });
    And('he slides his finger off the bar', () => {
      fireEvent.pointerMove(bar(), OFF);
    });
    And('he slides his finger back onto the bar', async () => {
      fireEvent.pointerMove(bar(), ON);
      await waitFor(() => expect(bar()).toHaveTextContent('Release to send'));
    });
    And('he lets go on the bar', async () => {
      fireEvent.pointerUp(bar(), ON);
      await act(async () => settledOutbox());
    });
    Then('one message is delivered with the words {string}', oneMessageWith);
  });

  Scenario('AC-7: typed words and Send are unchanged, and the mic hides when there are words', ({ Given, When, Then, And }) => {
    Given('the composer is open', open);
    When('he types {string}', (_c, words: string) => {
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: words } });
    });
    Then('the composer offers Send and no mic', () => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Speak a message' })).toBeNull();
    });
    When('he taps Send', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await act(async () => settledOutbox());
    });
    Then('one message is delivered with the words {string}', oneMessageWith);
    And('the message carries {int} attachments', (_c, count: number) => {
      expect(files()).toHaveLength(count);
    });
  });

  Scenario('AC-8: a file shared in opens the composer with the bar ready, and one hold sends file, words and voice note', ({ Given, Then, When, And }) => {
    Given('a screenshot {string} was shared into Postern and the composer opens', async (_c, name: string) => {
      setPendingShare({ files: [{ name, type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer }] });
      open();
    });
    Then('the screenshot {string} is attached', async (_c, name: string) => {
      await screen.findByLabelText(`Remove ${name}`);
    });
    And('the Hold to talk bar is there', async () => {
      await screen.findByRole('button', { name: 'Hold to talk' });
      barIsThere();
    });
    When('he holds the bar and says {string} and lets go', holdSayAndLetGo);
    Then('one message is delivered with the words {string}', oneMessageWith);
    And('the message carries {int} attachments', (_c, count: number) => {
      expect(files()).toHaveLength(count);
    });
    And('attachment 1 has mime {string}', (_c, mime: string) => {
      expect(files()[0]).toMatchObject({ mime });
    });
    And('attachment 2 has mime {string}', (_c, mime: string) => {
      expect(files()[1]).toMatchObject({ mime });
    });
  });

  Scenario('AC-9: a hold with no words heard sends nothing and says so', ({ Given, When, And, Then }) => {
    Given('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he presses and holds the bar', press);
    And('he lets go on the bar', async () => {
      fireEvent.pointerUp(bar(), ON);
      await act(async () => settledOutbox());
    });
    Then('nothing is delivered', nothingDelivered);
    And('the screen says {string}', async (_c, words: string) => {
      expect(await screen.findByText(words)).toBeInTheDocument();
    });
  });
  const phoneHas = (_c: unknown, a: string, b: string) => {
    setInputs([
      { deviceId: 'phone', label: a },
      { deviceId: 'buds', label: b },
    ]);
  };
  const listensOn = async (_c: unknown, label: string) => {
    await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
    expect((recognizers.at(-1)?.startedWith as { label: string } | undefined)?.label).toBe(label);
  };
  const namesBluetooth = async (_c: unknown, label: string) => {
    await waitFor(() => expect(screen.getByTestId('mic-name')).toHaveTextContent(`Listening on the Bluetooth microphone: ${label}.`));
  };
  // Real time, not a fake clock: the hold's own timers run as they do on the phone.
  const quietFor = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAgainOnDefault = async () => {
    await waitFor(() => expect(recognizers.at(-1)?.startedWith).toBeUndefined());
    expect(recognizers.length).toBeGreaterThan(1);
    // his finger never left the bar
    expect(bar()).toHaveTextContent(/Release to send|Starting the mic…/);
  };
  const namesThePhone = async () => {
    await waitFor(() => expect(screen.getByTestId('mic-name')).toHaveTextContent("Listening on the phone's own microphone."));
  };

  Scenario('AC-10: earbuds whose microphone gives no words within 2.5 s are let go while he still holds, and what he says after that reaches the message (mw-f7gmps.1)', ({ Given, When, And, Then }) => {
    Given('the phone has the inputs {string} and {string}', phoneHas);
    And('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he presses and holds the bar', press);
    Then('the recogniser listens on the {string} input', listensOn);
    And('the screen says it is listening on {string}', namesBluetooth);
    When('2.5 seconds pass with no words, his finger still on the bar', async () => {
      await quietFor(2600);
    });
    Then('the recogniser is started again on the default input', startedAgainOnDefault);
    And("the screen says it is listening on the phone's own microphone", namesThePhone);
    When('he says {string} and lets go', async (_c, words: string) => {
      await hear(words);
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
      fireEvent.pointerUp(bar(), ON);
      await act(async () => settledOutbox());
    });
    Then('one message is delivered with the words {string}', oneMessageWith);
    And('the message carries no voice note from the earbuds', () => {
      expect(files()).toHaveLength(0);
    });
  });

  Scenario("AC-11: the earbuds that heard nothing are not chosen again, and the next hold starts on the phone's own microphone at once (mw-f7gmps.1)", ({ Given, When, And, Then }) => {
    Given('the phone has the inputs {string} and {string}', phoneHas);
    And('the composer is open', open);
    When('he taps the mic beside Send', tapMic);
    And('he holds the bar on the earbuds until they are given up on, says {string} and lets go', async (_c, words: string) => {
      await press();
      await listensOn(undefined, 'Bluetooth headset');
      await quietFor(2600);
      await startedAgainOnDefault();
      await hear(words);
      fireEvent.pointerUp(bar(), ON);
      await act(async () => settledOutbox());
      await waitFor(() => expect(doubles.delivered).toHaveLength(1));
      await screen.findByRole('button', { name: 'Hold to talk' });
    });
    And('he presses and holds the bar again', async () => {
      opened.length = 0;
      recognizers = [];
      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Hold to talk' }));
    });
    Then('the recogniser listens on the default input at once', async () => {
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
      expect(recognizers).toHaveLength(1);
      expect(recognizers[0].startedWith).toBeUndefined();
      await namesThePhone();
    });
    And('the earbuds are not opened again', () => {
      expect(opened).not.toContain('buds');
    });
  });
});
