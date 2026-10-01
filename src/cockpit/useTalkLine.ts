// src/cockpit/useTalkLine.ts — everything the Talk line screen does, so the screen
// itself only draws. It runs the pure line (src/model/talkLine.ts) and does what the
// line asks: listen while the button is held, send the turn, take the Mayor's
// answers from the stored `talk` records, speak them, count the wait, and keep the
// screen awake while a talk is open.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { initialTalkLine, endTurn, talkLine, type TalkLineEvent, type TalkTurn } from '../model/talkLine';
import { initialTalkScreen, talkScreen } from '../model/talkScreen';
import { isListenSupported, startListening, type ListenMode, type ListenSession } from '../services/listen';
import { isSupported as canSpeak, speak, stop as stopSpeaking } from '../services/speech';
import { decodeTurn, newTalkId } from '../services/talk';
import { now } from '../services/clock';
import { holdAwake } from '../services/wakeLock';
import { sendTurn } from './send';
import { useTalkTurns } from './hooks';

function buzz(ms: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}

export function useTalkLine() {
  const [{ line, log }, dispatch] = useReducer(talkScreen, initialTalkLine, initialTalkScreen);
  const feed = useCallback((event: TalkLineEvent) => dispatch({ event, at: now() }), []);
  const turns = useTalkTurns();
  const [transcript, setTranscript] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [mode, setMode] = useState<ListenMode | undefined>();
  // 'starting' until the recogniser says the mic is open; 'fellBack' once on-device failed and the hold went on in cloud mode.
  const [mic, setMic] = useState<'starting' | 'ready'>('starting');
  const [fellBack, setFellBack] = useState(false);
  const listening = useRef<ListenSession | null>(null);
  // Names the hold the recogniser's callbacks belong to; cleared when the hold ends, so a late event is ignored.
  const hold = useRef<object | null>(null);
  const handled = useRef(new Set<string>());
  const sending = useRef<TalkTurn | undefined>(undefined);
  const supported = isListenSupported();

  // His turn goes out once, whenever the line asks for it.
  const outgoing = line.outgoing;
  useEffect(() => {
    if (!outgoing || sending.current === outgoing) return;
    sending.current = outgoing;
    sendTurn(outgoing).then(
      () => feed({ type: 'sent', at: now() }),
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
        feed({ type: 'incoming', turn });
        return;
      }
      if (!(line.phase === 'sending' && line.talk?.id === turn.talk.id)) handled.current.add(row.id);
    }
  }, [turns, line, feed]);

  // What is being said is spoken; the line moves on when the voice finishes. Leaving
  // the speaking state (a tap, the button, an end) silences it.
  const spoken = line.phase === 'speaking' ? line.speaking?.text : undefined;
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

  // Waiting for the Mayor is counted; the line gives up after its timeout.
  const waiting = line.phase === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => feed({ type: 'tick', now: now() }), 1000);
    return () => clearInterval(timer);
  }, [waiting, feed]);

  // The screen stays awake for as long as a talk is open.
  const open = line.talk !== undefined;
  useEffect(() => {
    if (!open) return;
    return holdAwake();
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
      lang: typeof navigator === 'undefined' ? undefined : navigator.language,
      onInterim: setTranscript,
      onStart: () => hold.current === thisHold && setMic('ready'),
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

  function cut(): void {
    feed({ type: 'cut' });
  }

  function end(): void {
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
    mode,
    mic,
    fellBack,
    supported,
    press,
    release,
    abort,
    cut,
    end,
    setModel: (model?: string) => feed({ type: 'setModel', model }),
  };
}
