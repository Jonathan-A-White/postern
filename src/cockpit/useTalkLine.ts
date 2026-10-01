// src/cockpit/useTalkLine.ts — everything the Talk line screen does, so the screen
// itself only draws. It runs the pure line (src/model/talkLine.ts) and does what the
// line asks: listen while the button is held, send the turn, take the Mayor's
// answers from the stored `talk` records, speak them, count the wait, and keep the
// screen awake while a talk is open.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { initialTalkLine, endTurn, talkLine, NO_ANSWER_IN_TIME, type TalkAbout, type TalkLineEvent, type TalkTurn } from '../model/talkLine';
import { initialTalkScreen, talkScreen } from '../model/talkScreen';
import { isListenSupported, startListening, type ListenMode, type ListenSession } from '../services/listen';
import { canChooseInput, openBluetoothInput } from '../services/micInput';
import { isSupported as canSpeak, speak, stop as stopSpeaking } from '../services/speech';
import { decodeTurn, newTalkId } from '../services/talk';
import { chime } from '../services/chime';
import { now } from '../services/clock';
import { holdAwake } from '../services/wakeLock';
import { holdVoiceAlive } from '../services/silentLoop';
import { announceAnswer, clearAnnouncement } from '../services/talkAnswerNotice';
import { sendTurn } from './send';
import { useTalkTurns } from './hooks';
import { useMayorHere } from './useMayorHere';

function buzz(ms: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useTalkLine() {
  const [{ line, log }, dispatch] = useReducer(talkScreen, initialTalkLine, initialTalkScreen);
  const feed = useCallback((event: TalkLineEvent) => dispatch({ event, at: now() }), []);
  const setAbout = useCallback((about?: TalkAbout) => feed({ type: 'setAbout', about }), [feed]);
  const turns = useTalkTurns();
  const [transcript, setTranscript] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [mode, setMode] = useState<ListenMode | undefined>();
  // 'starting' until the recogniser says the mic is open; 'fellBack' once on-device failed and the hold went on in cloud mode.
  const [mic, setMic] = useState<'starting' | 'ready'>('starting');
  const [fellBack, setFellBack] = useState(false);
  // The label of the Bluetooth input the hold listens on; nothing means the phone's default microphone.
  const [input, setInput] = useState<string | undefined>();
  const listening = useRef<ListenSession | null>(null);
  // Names the hold the recogniser's callbacks belong to; cleared when the hold ends, so a late event is ignored.
  const hold = useRef<object | null>(null);
  const handled = useRef(new Set<string>());
  const sending = useRef<TalkTurn | undefined>(undefined);
  const supported = isListenSupported();
  // Whether the Mayor's wait is connected, as the last poll said; the wait's timing reads it each tick.
  const here = useMayorHere();
  const hereNow = useRef(here);
  useEffect(() => {
    hereNow.current = here;
  }, [here]);

  // His turn goes out once, whenever the line asks for it.
  const outgoing = line.outgoing;
  useEffect(() => {
    if (!outgoing || sending.current === outgoing) return;
    sending.current = outgoing;
    sendTurn(outgoing).then(
      () => feed({ type: 'sent', at: now(), here: hereNow.current }),
      () => feed({ type: 'sendFailed' }),
    );
  }, [outgoing, feed]);

  // The Mayor's answers arrive as stored records. An answer that comes before the
  // line knows his turn went out waits until it does.
  useEffect(() => {
    for (const row of turns) {
      if (row.direction !== 'received' || handled.current.has(row.id)) continue;
      const turn = decodeTurn(row.plaintext);
      if (!turn) {
        handled.current.add(row.id);
        continue;
      }
      if (talkLine(line, { type: 'incoming', turn }) !== line) {
        handled.current.add(row.id);
        feed({ type: 'incoming', turn, hidden: pageHidden() });
        return;
      }
      if (!(line.phase === 'sending' && line.talk?.id === turn.talk.id)) handled.current.add(row.id);
    }
  }, [turns, line, feed]);

  // What is being said is spoken; the line moves on when the voice finishes. Leaving
  // the speaking state (a tap, the button, an end) silences it.
  // An answer that came while he was away is not spoken until he returns (see below).
  const unspoken = line.phase === 'speaking' && line.speaking?.unspoken === true;
  const spoken = line.phase === 'speaking' && !unspoken ? line.speaking?.text : undefined;
  useEffect(() => {
    if (spoken === undefined) return;
    let current = true;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (canSpeak()) speak(spoken, { onEnd: () => current && feed({ type: 'spoken' }) });
    else fallback = setTimeout(() => feed({ type: 'spoken' }), 0);
    return () => {
      current = false;
      clearTimeout(fallback);
      stopSpeaking();
    };
  }, [spoken, feed]);

  // An answer that came while he had left the app (Android suspends the voice of a page that is
  // not showing) is told by a notification with no words, and spoken the moment he returns.
  useEffect(() => {
    if (unspoken) void announceAnswer();
  }, [unspoken]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      feed({ type: 'visible' });
      void clearAnnouncement();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [feed]);

  // Waiting for the Mayor is counted; the line gives up after its timeout (longer while he is here).
  const waiting = line.phase === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => feed({ type: 'tick', now: now(), here: hereNow.current }), 1000);
    return () => clearInterval(timer);
  }, [waiting, feed]);

  // The Mayor turning from away to here, after the line gave up on his answer, is told once
  // (a buzz and a note); turning to here at any other time is silent.
  const wasHere = useRef<boolean | undefined>(undefined);
  const missed = line.error === NO_ANSWER_IN_TIME;
  useEffect(() => {
    if (here === undefined) return;
    if (wasHere.current === false && here && missed) chime();
    wasHere.current = here;
  }, [here, missed]);

  // The screen stays awake for as long as a talk is open, and a silent loop plays to try to keep
  // the voice alive with the screen off.
  const open = line.talk !== undefined;
  useEffect(() => {
    if (!open) return;
    const release = holdAwake();
    const quiet = holdVoiceAlive();
    return () => {
      release();
      quiet();
    };
  }, [open]);

  useEffect(
    () => () => {
      hold.current = null;
      listening.current?.abort();
    },
    [],
  );

  function press(): void {
    if (!supported || line.phase === 'listening' || line.phase === 'sending' || line.phase === 'waiting') return;
    setNotice(undefined);
    buzz(30);
    const thisHold = {};
    hold.current = thisHold;
    const started = startListening({
      lang: typeof document === 'undefined' ? undefined : document.documentElement.lang,
      onInterim: setTranscript,
      onStart: () => hold.current === thisHold && setMic('ready'),
      openInput: canChooseInput() ? openBluetoothInput : undefined,
      onInput: (label) => hold.current === thisHold && setInput(label),
      onFallback: () => {
        if (hold.current !== thisHold) return;
        setMode('cloud');
        setFellBack(true);
        setMic('starting');
      },
      // The recogniser failed while he is still holding: the hold is over, and he is told why.
      onError: (error) => {
        if (hold.current !== thisHold) return;
        hold.current = null;
        listening.current?.abort();
        listening.current = null;
        setNotice(error.message);
        feed({ type: 'cancel' });
      },
    });
    if (!started.ok) {
      hold.current = null;
      setNotice(started.error.message);
      return;
    }
    listening.current = started.session;
    setMode(started.session.mode);
    setMic('starting');
    setFellBack(false);
    setInput(undefined);
    setTranscript('');
    feed({ type: 'hold', talkId: line.talk?.id ?? newTalkId() });
  }

  async function release(): Promise<void> {
    const session = listening.current;
    if (!session) return;
    listening.current = null;
    hold.current = null;
    buzz(15);
    const result = await session.stop();
    if (!result.text.trim()) {
      setNotice(result.ok ? 'No speech was heard.' : result.error.message);
      feed({ type: 'cancel' });
      return;
    }
    feed({ type: 'release', text: result.text });
  }

  function abort(): void {
    hold.current = null;
    if (!listening.current) return;
    listening.current.abort();
    listening.current = null;
    feed({ type: 'cancel' });
  }

  function retry(): void {
    setNotice(undefined);
    feed({ type: 'retry' });
  }

  function cut(): void {
    feed({ type: 'cut' });
  }

  function end(): void {
    setNotice(undefined);
    const turn = endTurn(line);
    hold.current = null;
    listening.current?.abort();
    listening.current = null;
    feed({ type: 'end' });
    if (turn && turn.talk.turn > 0) sendTurn(turn).catch(() => setNotice('Could not tell the Mayor the talk is over.'));
  }

  return {
    line,
    log,
    transcript,
    notice: notice ?? line.error,
    canEnd: line.phase !== 'sending' && (line.talk !== undefined || notice !== undefined || line.error !== undefined),
    mode,
    mic,
    fellBack,
    input,
    here,
    supported,
    press,
    release,
    abort,
    cut,
    retry,
    end,
    setModel: (model?: string) => feed({ type: 'setModel', model }),
    setAbout,
  };
}
