// src/cockpit/useTalkLine.ts — everything the Talk line screen does, so the screen
// itself only draws. It runs the pure line (src/model/talkLine.ts) and does what the
// line asks: listen while the button is held, send the turn, take the Mayor's
// answers from the stored `talk` records, speak them, count the wait, and keep the
// screen awake while a talk is open.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialTalkLine, endTurn, isLateAnswer, talkLine, NO_ANSWER_IN_TIME, type TalkAbout, type TalkLineEvent, type TalkTurn } from '../model/talkLine';
import { initialTalkScreen, talkScreenReducer } from '../model/talkScreen';
import { earlierTalks, openTalk } from '../model/talkLog';
import { messagesRepo } from '../data/repositories';
import { writeBehind } from '../services/deliver';
import { isPausedOn, isSpeaking, isSupported as canSpeak, pause as pauseSpeaking, restart as restartSpeaking, resume as resumeSpeaking, speak, stop as stopSpeaking, TALK_ANSWER_KEY, whenDone } from '../services/speech';
import { decodeTurn, newTalkId } from '../services/talk';
import { chime } from '../services/chime';
import { now } from '../services/clock';
import { holdAwake } from '../services/wakeLock';
import { holdVoiceAlive } from '../services/silentLoop';
import { holdWhileActive, type IdleHold } from '../services/idleHold';
import { announceAnswer, clearAnnouncement } from '../services/talkAnswerNotice';
import { sendTurn } from './send';
import { useBeadTitles, useTalkTurns } from './hooks';
import { useMayorHere } from './useMayorHere';
import { useHold } from 'bsv-kit/composer';
import { APP_NAME } from './holdBar';

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

const NO_ROWS: never[] = [];

/** `fresh`: the screen was opened to start a new talk (a Talk button says what it is about), so the open one is left as it is. */
export function useTalkLine({ fresh = false }: { fresh?: boolean } = {}) {
  const [{ line, log }, dispatch] = useReducer(talkScreenReducer, initialTalkLine, initialTalkScreen);
  // What keeps the phone awake for the open talk; any event but the wait's own tick (a hold, an answer, a tap) re-arms it (mw-1ox07o.1).
  const holds = useRef(new Set<IdleHold>());
  const feed = useCallback((event: TalkLineEvent) => {
    if (event.type !== 'tick') for (const held of holds.current) held.rearm();
    dispatch({ event, at: now() });
  }, []);
  const setAbout = useCallback((about?: TalkAbout) => feed({ type: 'setAbout', about }), [feed]);
  const stored = useTalkTurns();
  const turns = stored ?? NO_ROWS;
  // Listening while the button is held is the hold's (useHold, shared with the composer); a recogniser that fails mid-hold ends the turn.
  const hold = useHold({ appName: APP_NAME, onFailed: () => feed({ type: 'cancel' }) });
  const handled = useRef(new Set<string>());
  const sending = useRef<TalkTurn | undefined>(undefined);
  // Bead titles for the voice (mw-gq6.224): read through a ref so a view refresh never restarts speech.
  const titles = useRef<ReadonlyMap<string, string>>(new Map());
  const beadTitles = useBeadTitles();
  useEffect(() => {
    titles.current = beadTitles;
  }, [beadTitles]);
  // Whether the Mayor's wait is connected, as the last poll said; the wait's timing reads it each tick.
  const here = useMayorHere(line.phase === 'waiting');
  const hereNow = useRef(here);
  useEffect(() => {
    hereNow.current = here;
  }, [here]);

  // The open talk is read back from its stored rows once they are read, so leaving the screen or
  // reloading the app loses nothing: his turns and the Mayor's answers are on the screen again, the next
  // hold continues the same talk, and an answer he never heard waits to be played.
  const seeded = useRef(fresh);
  // The row of the Mayor's answer the line is speaking, so that playing it can be written down.
  const speakingRow = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (stored === undefined || seeded.current) return;
    seeded.current = true;
    const open = openTalk(stored, now());
    if (!open) return;
    for (const id of open.rows) handled.current.add(id);
    speakingRow.current = open.unheardRow;
    // An answer he left while it was speaking waits paused in the speech: the line shows it paused, for him to Resume.
    const speaking = open.line.speaking;
    const waitsPaused = open.unheardRow !== undefined && speaking !== undefined && isPausedOn(TALK_ANSWER_KEY, speaking.text);
    dispatch({ seed: waitsPaused ? { ...open, line: { ...open.line, phase: 'idle', speaking: undefined, paused: speaking } } : open });
  }, [stored]);

  // The talks before this one are listed above it. The talk the screen shows as its own (its id is kept after
  // End, while its turns stay on the page) is left out, and so is the open talk until it has been read back.
  const [shownId, setShownId] = useState<string | undefined>();
  if (line.talk && line.talk.id !== shownId) setShownId(line.talk.id);
  const earlier = useMemo(() => {
    if (!stored) return [];
    return earlierTalks(stored, shownId ?? (fresh ? undefined : openTalk(stored, now())?.id));
  }, [stored, shownId, fresh]);

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
      // A late answer (to a turn before the one he is on) is always fed: the line plays it when free, the log shows it otherwise.
      if (talkLine(line, { type: 'incoming', turn }) !== line || isLateAnswer(line, turn)) {
        handled.current.add(row.id);
        if (turn.role === 'answer') speakingRow.current = row.id;
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
  // A hold over the answer pauses it instead of stopping it, so its speech keeps the sentence reached (mw-q6n8m0.9);
  // Restart is a Resume that speaks from the top.
  const keepForResume = useRef(false);
  const fromTheTop = useRef(false);
  // Leaving the screen pauses the answer instead of stopping it (his words, mw-q6n8m0.10). This cleanup is declared before
  // the speech effect's, so on unmount it has already run when that one does.
  const leaving = useRef(false);
  const holdingSpeech = line.phase === 'speaking' && line.speaking?.holding === true;
  const holdingRef = useRef(holdingSpeech);
  useEffect(() => {
    holdingRef.current = holdingSpeech;
  }, [holdingSpeech]);
  useEffect(() => {
    leaving.current = false;
    return () => {
      leaving.current = true;
      // Whatever ends the answer on another screen (played out, or Stop in the bar) is written on its row, which this screen can no longer do.
      const row = speakingRow.current;
      if (row !== undefined && !holdingRef.current) whenDone(TALK_ANSWER_KEY, () => writeBehind(messagesRepo.markHeard(row), 'that the answer was heard'));
    };
  }, []);
  useEffect(() => {
    if (spoken === undefined) return;
    let current = true;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const again = fromTheTop.current;
    fromTheTop.current = false;
    if (canSpeak()) speak(spoken, { titles: titles.current, key: TALK_ANSWER_KEY, resumeIfPaused: !again, onEnd: () => current && feed({ type: 'spoken' }) });
    else fallback = setTimeout(() => feed({ type: 'spoken' }), 0);
    return () => {
      current = false;
      clearTimeout(fallback);
      if (leaving.current && !holdingSpeech) pauseSpeaking();
      else if (keepForResume.current) {
        keepForResume.current = false;
        pauseSpeaking();
      } else stopSpeaking();
    };
  }, [spoken, holdingSpeech, feed]);
  // The speech under the Talk line's key does not outlive what the line holds: nothing playing or paused for Resume means it is stopped
  // (a new question, Stop, End). Leaving the screen only pauses it, so it can be Resumed from the next screen or when he comes back.
  // A screen that has just opened holds nothing yet but may find an answer paused from the last visit, so only a line that let go of one stops it.
  const answerKept = line.phase === 'speaking' || line.paused !== undefined;
  const wasKept = useRef(false);
  useEffect(() => {
    const letGo = wasKept.current && !answerKept;
    wasKept.current = answerKept;
    if (letGo && isSpeaking(TALK_ANSWER_KEY)) stopSpeaking();
  }, [answerKept]);

  // An answer is heard once it has been played to its end or he has stopped it: that is written on its row,
  // so it never plays by itself again. One he left the screen on while it played is not heard.
  const playingNow = (line.phase === 'speaking' && line.speaking?.holding === false && line.speaking.unspoken !== true) || line.paused !== undefined;
  const wasPlaying = useRef<string | undefined>(undefined);
  useEffect(() => {
    const playing = playingNow ? speakingRow.current : undefined;
    const before = wasPlaying.current;
    wasPlaying.current = playing;
    if (before !== undefined && before !== playing) writeBehind(messagesRepo.markHeard(before), 'that the answer was heard');
  }, [playingNow]);

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

  // The screen stays awake while a talk is open, and a silent loop plays to try to keep
  // the voice alive with the screen off; but never while he holds the button, where a page playing
  // audio can take the phone's microphone from the recogniser and end it over and over (mw-j0f2d.37).
  // Both let go after 5 minutes with no hold, answer or tap, and come back with the next one (mw-1ox07o.1).
  const open = line.talk !== undefined;
  const holding = line.phase === 'listening';
  useEffect(() => {
    if (!open) return;
    const all = holds.current;
    const held = holdWhileActive(holdAwake);
    all.add(held);
    return () => {
      all.delete(held);
      held.release();
    };
  }, [open]);
  useEffect(() => {
    if (!open || holding) return;
    const all = holds.current;
    const held = holdWhileActive(holdVoiceAlive);
    all.add(held);
    return () => {
      all.delete(held);
      held.release();
    };
  }, [open, holding]);

  function press(): void {
    if (!hold.supported || line.phase === 'listening' || line.phase === 'sending' || line.phase === 'waiting') return;
    if (!hold.begin()) return;
    // The speech is paused at once, so its sound is not in the way of the microphone; the line keeps the answer for Resume.
    if (line.phase === 'speaking' && line.speaking?.holding === false && !line.speaking.unspoken) {
      keepForResume.current = true;
      pauseSpeaking();
    }
    feed({ type: 'hold', talkId: line.talk?.id ?? newTalkId() });
  }

  async function release(): Promise<void> {
    const released = await hold.finish();
    if (released.status === 'idle') return;
    if (released.status === 'empty') {
      feed({ type: 'cancel' });
      return;
    }
    // words the recogniser showed but did not settle ('kept') still go: the line has no box to keep them in
    feed({ type: 'release', text: released.text });
  }

  function abort(): void {
    if (hold.drop() !== undefined) feed({ type: 'cancel' });
  }

  function retry(): void {
    hold.setNotice(undefined);
    feed({ type: 'retry' });
  }

  function cut(): void {
    feed({ type: 'cut' });
  }

  // The speaking bar over the Mayor's answer (mw-q6n8m0.9). A pause by the bar leaves the line speaking; a pause by a hold
  // left the answer paused in the line, so Resume and Restart bring the line back to speaking.
  function resume(): void {
    if (line.paused) feed({ type: 'resume' });
    else resumeSpeaking();
  }

  function restart(): void {
    if (line.paused) {
      fromTheTop.current = true;
      feed({ type: 'resume' });
    } else restartSpeaking();
  }

  function end(): void {
    hold.setNotice(undefined);
    const turn = endTurn(line);
    hold.drop();
    feed({ type: 'end' });
    if (turn && turn.talk.turn > 0) sendTurn(turn).catch(() => hold.setNotice('Could not tell the Mayor the talk is over.'));
  }

  return {
    line,
    log,
    earlier,
    transcript: hold.transcript,
    notice: hold.notice ?? line.error,
    canEnd: line.phase !== 'sending' && (line.talk !== undefined || hold.notice !== undefined || line.error !== undefined),
    mode: hold.mode,
    mic: hold.mic,
    fellBack: hold.fellBack,
    input: hold.input,
    here,
    supported: hold.supported,
    press,
    release,
    abort,
    cut,
    pause: pauseSpeaking,
    resume,
    restart,
    retry,
    end,
    setModel: (model?: string) => feed({ type: 'setModel', model }),
    setAbout,
  };
}
