// features/steps/ideas-only-recorded.steps.tsx — runs features/ideas-only-recorded.feature (mw-8ifimx.4):
// the real General channel and bead page (Composer, hold-to-talk bar, outbox) and a Release card, with
// the kept Ideas only answer in a Dexie and Date frozen. The delivery is the double: what it takes in
// is "the record reaches the backend".
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, settingsRepo, viewRepo } from '../../src/data/repositories';
import { indexView } from '../../src/model/tree';
import type { Need } from '../../src/model/view';
import { lock, setKey } from '../../src/services/keySession';
import { forgetSilentInputs } from 'voice-kit/composer';
import { forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { settledWrites } from '../../src/services/deliver';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { fixtureDetail, fixtureView } from '../../tests/support/cockpit-fixture';
import { emptyPhone } from '../../tests/support/empty-phone';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';
import { ToastHost } from '../../src/ui/toast';
import { dismissAllToasts } from '../../src/ui/toastStore';
import type { GovernorAction } from '../../src/model/conversation';

const doubles = vi.hoisted(() => ({
  delivered: [] as { text: string }[],
  actions: [] as unknown[],
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
  deliverThreaded: async (message: { text: string }) => {
    doubles.delivered.push(message);
    return { txid: 'ef'.repeat(32), channel: 'direct' };
  },
  deliverAction: async (action: GovernorAction) => {
    doubles.actions.push(action);
    return { txid: 'ab'.repeat(32), channel: 'direct' };
  },
}));
vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));
// the recorder the package's hold uses (voice-kit/composer's own module; vitest.config.ts runs the package through vite)
vi.mock('../../node_modules/voice-kit/packages/composer/dist/recorder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../node_modules/voice-kit/packages/composer/dist/recorder.js')>()),
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

const HIM = publicKeyHexFromMasterKey(doubles.key);
const BEAD = 'mw-f758y.31.2';
const secs = (iso: string): number => new Date(iso).getTime() / 1000;

const approve: Need = { kind: 'approve', bead: BEAD, epic: '', title: 'Map zoom', since: new Date(Date.now() - 60_000).toISOString(), text: '', recommended: 'Release', options: ['Release'], blocks: 0, steps: [] };

afterAll(() => {
  cleanup();
  lock();
  thawClock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start(clock: string, until: string | null): Promise<void> {
  cleanup();
  dismissAllToasts();
  vi.restoreAllMocks();
  thawClock();
  freezeClock(clock);
  recognizers = [];
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer;
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
  forgetSilentInputs();
  forgetTaps();
  setKey(doubles.key);
  doubles.delivered = [];
  doubles.actions = [];
  // The last scenario's sender and write-behinds finish before the phone is emptied (its message and Recorded note share a txid with this one's).
  await emptyPhone();
  forgetOutboxState();
  const until21 = until ? secs(until) : 0;
  await settingsRepo.setIdeasOnly({
    key: HIM,
    setting: { until: until21, reaches: {} },
    state: until ? { on: true, until: until21, by: 'until' } : { on: false, until: 0, by: '' },
    at: 0,
  });
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView()), written_at: fixtureView().written_at, source: 'live', fetchedAt: Date.now() });
  const detail = fixtureDetail(BEAD);
  if (detail) await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/blobs')) return new Response(JSON.stringify({ hash: 'ab'.repeat(32), size: 100 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      return new Response('not found', { status: 404 });
    }),
  );
}

const channel = () =>
  render(
    <>
      <TalkScreen thread="general" />
      <ToastHost />
    </>,
  );

const feature = await loadFeature('features/ideas-only-recorded.feature');

describeFeature(feature, ({ Scenario }) => {
  const on = () => start('2026-10-01T14:00:00', '2026-10-01T21:00:00');
  const off = () => start('2026-10-01T14:00:00', null);
  const openChannel = async () => {
    channel();
    await screen.findByLabelText('Message');
  };
  const writeAndSend = async (_c: unknown, words: string) => {
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: words } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => settledOutbox());
  };
  const reachesBackend = async (_c: unknown, words: string) => {
    await waitFor(() => expect(doubles.delivered).toHaveLength(1));
    expect(doubles.delivered[0].text).toBe(words);
  };
  const noteSays = async (_c: unknown, words: string) => {
    const message = await screen.findByTestId('message');
    await waitFor(() => expect(within(message).getByTestId('recorded-note')).toHaveTextContent(words));
  };
  const noNote = async () => {
    await screen.findByTestId('message');
    // the note is kept by a write-behind: a late one is let land before looking
    await act(async () => settledWrites());
    expect(screen.queryByTestId('recorded-note')).toBeNull();
  };

  Scenario('mw-8ifimx.4 AC-2: a text sent in General shows Recorded for after 21:00 and the record still goes', ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('the General channel is open', openChannel);
    When('he writes {string} and taps Send', writeAndSend);
    Then('the record reaches the backend with the words {string}', reachesBackend);
    And('under his message it says {string}', noteSays);
  });

  Scenario('mw-8ifimx.4 AC-2: a text sent with the mode off has no note', ({ Given, And, When, Then }) => {
    Given("Ideas only is off and the phone's clock says 14:00", off);
    And('the General channel is open', openChannel);
    When('he writes {string} and taps Send', writeAndSend);
    Then('the record reaches the backend with the words {string}', reachesBackend);
    And('his message has no Recorded note', noNote);
  });

  Scenario('mw-8ifimx.4 AC-2: the note stays on the message after a reload and once its record is kept', ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('the General channel is open', openChannel);
    When('he writes {string} and taps Send', writeAndSend);
    And("the backend's record of it is kept and the app is reloaded", async () => {
      await reachesBackend(undefined, 'an idea about maps');
      await act(async () => settledWrites());
      const txid = 'ef'.repeat(32);
      // the phone keeps its own record of what it sent, and the outbox row has been seen coming back
      await db.messages.put({ id: `${txid}:0`, txid, vout: 0, seq: 5, class: 'message', to: doubles.mayorKey, from: HIM, ts: secs('2026-10-01T14:00:00'), ciphertext: '', plaintext: 'an idea about maps', direction: 'sent', read: true });
      await db.outbox.toCollection().modify({ state: 'acked' });
      cleanup();
      forgetOutboxState();
      channel();
    });
    Then('under his message it says {string}', noteSays);
  });

  Scenario('mw-8ifimx.4 AC-2: a voice note sent on a bead shows the note and still goes', ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('a bead page is open', async () => {
      render(
        <>
          <BeadScreen id={BEAD} />
          <ToastHost />
        </>,
      );
      await screen.findByLabelText('Message');
    });
    When('he holds the mic bar, says {string} and lets go', async (_c, words: string) => {
      fireEvent.click(await screen.findByRole('button', { name: 'Speak a message' }));
      const bar = await screen.findByRole('button', { name: 'Hold to talk' });
      fireEvent.pointerDown(bar);
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
      await screen.findByRole('button', { name: 'Release to send' });
      act(() => recognizers.at(-1)?.onresult?.({ results: [[{ transcript: words }]] }));
      vi.spyOn(screen.getByRole('button', { name: 'Release to send' }), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 96, width: 300, height: 96, x: 0, y: 0, toJSON: () => ({}) });
      fireEvent.pointerUp(screen.getByRole('button', { name: 'Release to send' }), { clientX: 10, clientY: 10 });
      await act(async () => settledOutbox());
    });
    Then('the record reaches the backend with the words {string}', reachesBackend);
    And('under his message it says {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getAllByTestId('recorded-note').at(-1)).toHaveTextContent(words));
    });
  });

  const releaseCard = async () => {
    render(<NeedCard need={approve} index={indexView(fixtureView())} />);
  };
  const tapRelease = async () => {
    const card = await screen.findByTestId('need-card');
    const button = await waitFor(() => {
      const found = within(card).getByRole('button', { name: 'Release' });
      expect(found).toBeEnabled();
      return found;
    });
    fireEvent.click(button);
    await act(async () => settledOutbox());
  };
  const cardSays = async (_c: unknown, words: string) => {
    const card = screen.getByTestId('need-card');
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent(words));
    expect(within(card).queryByRole('button', { name: 'Release' })).toBeNull();
  };

  Scenario("mw-8ifimx.4 AC-2: a Release tap's label reads Recorded for after 21:00", ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('a release card is open', releaseCard);
    When('he taps Release', tapRelease);
    Then('the card says {string} where Release was', cardSays);
  });

  Scenario('mw-8ifimx.4 AC-2: a Release tap with the mode off still says it is waiting for the factory', ({ Given, And, When, Then }) => {
    Given("Ideas only is off and the phone's clock says 14:00", off);
    And('a release card is open', releaseCard);
    When('he taps Release', tapRelease);
    Then('the card says {string} where Release was', cardSays);
  });
});
