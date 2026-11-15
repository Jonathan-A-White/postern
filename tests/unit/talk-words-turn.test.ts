// tests/unit/talk-words-turn.test.ts — mw-deiheir.3: the Talk line takes a turn from words with no hold of the button
// (useTalkLine().words: begin, heard, send, cancel), and says when a whole answer has been spoken (onAnswerSpoken).
// The real hook, the real Dexie, voice-kit's honest microphone and speech synthesiser; only the delivery of a turn is a double.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMic, type MicFake } from 'voice-kit/testing/mic';
import { forgetSilentInputs } from 'voice-kit/composer';
import { useTalkLine } from '../../src/cockpit/useTalkLine';
import { db, type MessageRow } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { getSpeech, stop as stopSpeaking } from '../../src/services/speech';
import { encodeTurn } from '../../src/services/talk';
import { type TalkTurn } from '../../src/model/talkLine';
import { installHonestSpeech, type HonestSpeech } from '../support/honest-speech';

const sendTurn = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendTurn: (...args: unknown[]) => sendTurn(...args),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

class FakeAudio {
  loop = false;
  src: string;
  constructor(src: string) {
    this.src = src;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

let mic: MicFake;
let speech: HonestSpeech;

beforeEach(async () => {
  cleanup();
  stopSpeaking();
  sendTurn.mockReset();
  sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  setKey(new Uint8Array(32).fill(7));
  forgetSilentInputs();
  mic = installMic(window);
  speech = installHonestSpeech();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  stopSpeaking();
  mic.uninstall();
  speech.uninstall();
  lock();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let seq = 0;
async function store(turn: TalkTurn, direction: 'sent' | 'received', heard?: boolean): Promise<string> {
  seq += 1;
  const txid = `direct:${String(seq).padStart(64, '0')}`;
  const row: MessageRow = {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq,
    class: 'talk',
    to: 'to',
    from: 'from',
    ts: Math.floor(Date.now() / 1000) - 5 + seq,
    ciphertext: '',
    plaintext: encodeTurn(turn),
    direction,
    read: direction === 'sent',
    ...(heard === undefined ? {} : { heard }),
  };
  await db.messages.put(row);
  return row.id;
}

const answer = (text: string, id = 't-words', turn = 1): TalkTurn => ({ talk: { id, turn }, text, role: 'answer' });

/** The hook, its words turn opened, heard and sent, and the send settled: the line is waiting. */
async function waitingLine(onAnswerSpoken?: () => void) {
  const view = renderHook(() => useTalkLine({ onAnswerSpoken }));
  await waitFor(() => expect(view.result.current.supported).toBe(true));
  act(() => {
    view.result.current.words.begin();
  });
  act(() => view.result.current.words.heard('what is in flight'));
  act(() => view.result.current.words.send('what is in flight'));
  await waitFor(() => expect(view.result.current.line.phase).toBe('waiting'));
  return view;
}

const advance = (ms: number) => act(async () => speech.advance(ms));

describe('a turn from words (useTalkLine().words)', () => {
  it('begin() while waiting is not taken, says what the screen says, and leaves the line as it was', async () => {
    const view = await waitingLine();
    const before = view.result.current.line;
    let taken: ReturnType<typeof view.result.current.words.begin> | undefined;
    act(() => {
      taken = view.result.current.words.begin();
    });
    expect(taken).toEqual({ taken: false, status: 'Waiting for the Mayor…' });
    expect(view.result.current.line).toBe(before);
  });

  it('begin() while sending is not taken and says Sending…', async () => {
    sendTurn.mockReturnValue(new Promise(() => {}));
    const view = renderHook(() => useTalkLine());
    await waitFor(() => expect(view.result.current.supported).toBe(true));
    act(() => {
      view.result.current.words.begin();
    });
    act(() => view.result.current.words.send('hello'));
    await waitFor(() => expect(view.result.current.line.phase).toBe('sending'));
    let taken: ReturnType<typeof view.result.current.words.begin> | undefined;
    act(() => {
      taken = view.result.current.words.begin();
    });
    expect(taken).toEqual({ taken: false, status: 'Sending…' });
  });

  it('begin() on an idle line is taken and the line listens', async () => {
    const view = renderHook(() => useTalkLine());
    await waitFor(() => expect(view.result.current.supported).toBe(true));
    let taken: ReturnType<typeof view.result.current.words.begin> | undefined;
    act(() => {
      taken = view.result.current.words.begin();
    });
    expect(taken).toEqual({ taken: true });
    expect(view.result.current.line.phase).toBe('listening');
  });

  it('begin() over a spoken answer pauses it exactly as press() does', async () => {
    const seed = async () => {
      await db.messages.clear();
      await store({ talk: { id: 't-words', turn: 1 }, text: 'what landed?', role: 'turn' }, 'sent');
      await store(answer('First thing. Second thing.'), 'received', false);
    };
    const speaking = async () => {
      const view = renderHook(() => useTalkLine());
      await waitFor(() => expect(view.result.current.line.phase).toBe('speaking'));
      await advance(0);
      await waitFor(() => expect(getSpeech().status).toBe('playing'));
      return view;
    };

    await seed();
    const pressed = await speaking();
    act(() => pressed.result.current.press());
    await waitFor(() => expect(pressed.result.current.line.phase).toBe('listening'));
    const afterPress = { line: pressed.result.current.line, speech: getSpeech().status };
    act(() => pressed.result.current.abort());
    pressed.unmount();
    cleanup();
    stopSpeaking();

    await seed();
    const begun = await speaking();
    act(() => {
      expect(begun.result.current.words.begin()).toEqual({ taken: true });
    });
    await waitFor(() => expect(begun.result.current.line.phase).toBe('listening'));
    expect(begun.result.current.line).toEqual(afterPress.line);
    expect(begun.result.current.line.paused).toMatchObject({ text: 'First thing. Second thing.' });
    expect(getSpeech().status).toBe(afterPress.speech);
    expect(getSpeech().status).toBe('paused');
  });

  it("send('') leaves the line idle and sends no turn; so does cancel()", async () => {
    const view = renderHook(() => useTalkLine());
    await waitFor(() => expect(view.result.current.supported).toBe(true));
    act(() => {
      view.result.current.words.begin();
    });
    act(() => view.result.current.words.heard('um'));
    act(() => view.result.current.words.send(''));
    expect(view.result.current.line.phase).toBe('idle');
    expect(view.result.current.transcript).toBe('');
    act(() => {
      view.result.current.words.begin();
    });
    expect(view.result.current.line.phase).toBe('listening');
    act(() => view.result.current.words.cancel());
    expect(view.result.current.line.phase).toBe('idle');
    await advance(50);
    expect(sendTurn).not.toHaveBeenCalled();
    expect(view.result.current.line.outgoing).toBeUndefined();
  });

  it('shows the words heard where a hold shows its live transcript, and opens no microphone', async () => {
    const view = renderHook(() => useTalkLine());
    await waitFor(() => expect(view.result.current.supported).toBe(true));
    act(() => {
      view.result.current.words.begin();
    });
    act(() => view.result.current.words.heard('what is in'));
    expect(view.result.current.transcript).toBe('what is in');
    act(() => view.result.current.words.heard('what is in flight'));
    expect(view.result.current.transcript).toBe('what is in flight');
    expect(view.result.current.wordsOpen).toBe(true);
    act(() => view.result.current.words.send('what is in flight'));
    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0][0]).toMatchObject({ role: 'turn', text: 'what is in flight', talk: { turn: 1 } });
    // no recogniser started, no stream asked for
    expect(mic.recognitions).toHaveLength(0);
    expect(mic.requests).toHaveLength(0);
    expect(mic.streams).toHaveLength(0);
  });
});

describe('onAnswerSpoken', () => {
  const answerArrives = (text: string, role: 'answer' | 'holding') => act(async () => void (await store({ talk: { id: talkId(), turn: 1 }, text, role }, 'received', false)));
  let current: ReturnType<typeof renderHook<ReturnType<typeof useTalkLine>, unknown>> | undefined;
  const talkId = () => current!.result.current.line.talk!.id;
  const spokenOut = async () => {
    await advance(0);
    for (let i = 0; i < 4; i += 1) {
      await act(async () => speech.finishAll());
      await advance(50);
    }
  };

  it('is called once after a real answer has been spoken to its end', async () => {
    const spoken = vi.fn();
    const view = await waitingLine(spoken);
    current = view;
    await store({ talk: { id: talkId(), turn: 1 }, text: 'what landed?', role: 'turn' }, 'sent');
    await answerArrives('Three things landed.', 'answer');
    await waitFor(() => expect(view.result.current.line.phase).toBe('speaking'));
    await advance(0);
    expect(spoken).not.toHaveBeenCalled();
    await spokenOut();
    await waitFor(() => expect(view.result.current.line.phase).toBe('idle'));
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('is not called for a holding reply', async () => {
    const spoken = vi.fn();
    const view = await waitingLine(spoken);
    current = view;
    await answerArrives('One moment.', 'holding');
    await waitFor(() => expect(view.result.current.line.speaking?.holding).toBe(true));
    await spokenOut();
    await waitFor(() => expect(view.result.current.line.phase).toBe('waiting'));
    expect(spoken).not.toHaveBeenCalled();
  });

  it('is not called for an answer cut by cut()', async () => {
    const spoken = vi.fn();
    const view = await waitingLine(spoken);
    current = view;
    await answerArrives('Three things landed.', 'answer');
    await waitFor(() => expect(view.result.current.line.phase).toBe('speaking'));
    await advance(0);
    act(() => view.result.current.cut());
    await spokenOut();
    expect(view.result.current.line.phase).toBe('idle');
    expect(spoken).not.toHaveBeenCalled();
  });

  it('is not called for an answer kept unspoken while the page is hidden', async () => {
    const spoken = vi.fn();
    const view = await waitingLine(spoken);
    current = view;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await answerArrives('Three things landed.', 'answer');
    await waitFor(() => expect(view.result.current.line.speaking?.unspoken).toBe(true));
    await spokenOut();
    expect(view.result.current.line.phase).toBe('speaking');
    expect(spoken).not.toHaveBeenCalled();
  });

  it('is not called for an answer a hold paused', async () => {
    const spoken = vi.fn();
    const view = await waitingLine(spoken);
    current = view;
    await answerArrives('First thing. Second thing.', 'answer');
    await waitFor(() => expect(view.result.current.line.phase).toBe('speaking'));
    await advance(0);
    act(() => {
      view.result.current.words.begin();
    });
    await spokenOut();
    expect(view.result.current.line.paused).toBeDefined();
    expect(spoken).not.toHaveBeenCalled();
  });
});
