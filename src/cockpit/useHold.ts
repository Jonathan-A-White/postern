// src/cockpit/useHold.ts — one hold of the hold-to-talk bar: the phone listens while the bar is held
// (services/listen), the words so far stream into `transcript`, and letting go hands back what was said.
// The Talk line (useTalkLine) and the composer (Composer) both hold through this, so a hold is one
// thing in the app. With `record` the same hold also records the voice (services/recorder), so a
// release hands back the audio beside the words. The recorder takes the recogniser's microphone and
// never opens another (mw-f7gmps.1): on Android a second capture moves the phone onto the Bluetooth
// route the recogniser hears nothing on. On a chosen input it records a copy of the input's track;
// when the hold leaves that input for the default microphone the recording goes with it; on the
// default microphone it records only when the phone has no Bluetooth input at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isListenSupported, startListening, type ListenMode, type ListenSession } from '../services/listen';
import { canChooseInput, openHoldInput } from '../services/micInput';
import { canRecord, VoiceRecorder, type Recording } from '../services/recorder';

function buzz(ms: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}

/** Which microphone the hold is on, for the screen: the Bluetooth input chosen (his car's, say), or the phone's default. */
export function micName(input: string | undefined): string {
  return input ? `Listening on the Bluetooth microphone: ${input}.` : "Listening on the phone's own microphone.";
}

/** What a release came to: nothing was held, a hold heard no words, or the words (and the voice, when it could be recorded). */
export type Released = { status: 'idle' } | { status: 'empty' } | { status: 'heard'; text: string; recording?: Recording };

interface HeldRecording {
  recorder: VoiceRecorder;
  started: Promise<boolean>;
}

export interface HoldOptions {
  /** Record the voice along with the words. A recording that cannot be made leaves the words alone. */
  record?: boolean;
  /** The recogniser failed while he is still holding: the hold is over (the notice says why). */
  onFailed?: () => void;
}

export function useHold({ record = false, onFailed }: HoldOptions = {}) {
  const [transcript, setTranscript] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [mode, setMode] = useState<ListenMode | undefined>();
  // 'starting' until the recogniser says the mic is open; 'fellBack' once on-device failed and the hold went on in cloud mode.
  const [mic, setMic] = useState<'starting' | 'ready'>('starting');
  const [fellBack, setFellBack] = useState(false);
  // The label of the Bluetooth input the hold listens on; nothing means the phone's default microphone.
  const [input, setInput] = useState<string | undefined>();
  const listening = useRef<ListenSession | null>(null);
  const recording = useRef<HeldRecording | null>(null);
  // Names the hold the recogniser's callbacks belong to; cleared when the hold ends, so a late event is ignored.
  const hold = useRef<object | null>(null);
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  }, [onFailed]);

  const dropRecording = useCallback(() => {
    const taken = recording.current;
    recording.current = null;
    // the recorder may still be opening the microphone: it is cancelled once it is open
    if (taken) void taken.started.then(() => taken.recorder.cancel());
  }, []);

  useEffect(
    () => () => {
      hold.current = null;
      listening.current?.abort();
      dropRecording();
    },
    [dropRecording],
  );

  /** Starts listening. False when the hold could not start (the notice says why). */
  const begin = useCallback((): boolean => {
    setNotice(undefined);
    buzz(30);
    const thisHold = {};
    hold.current = thisHold;
    const recordHold = record && canRecord();
    const startRecording = (track?: MediaStreamTrack) => {
      const recorder = new VoiceRecorder();
      recording.current = {
        recorder,
        started: recorder.start(track).then(
          () => true,
          () => false,
        ),
      };
    };
    const choosing = canChooseInput();
    const started = startListening({
      lang: typeof document === 'undefined' ? undefined : document.documentElement.lang,
      onInterim: setTranscript,
      onStart: () => hold.current === thisHold && setMic('ready'),
      openInput: choosing
        ? async () => {
            const opened = await openHoldInput();
            if (recordHold && hold.current === thisHold) {
              if (opened.input) startRecording(opened.input.track);
              else if (!opened.bluetooth) startRecording();
            }
            return opened.input;
          }
        : undefined,
      onInput: (label) => {
        if (hold.current !== thisHold) return;
        setInput(label);
        // the hold left the chosen input: its recording goes with it, and no other microphone is opened
        if (label === undefined) dropRecording();
      },
      onFallback: () => {
        if (hold.current !== thisHold) return;
        setMode('cloud');
        setFellBack(true);
        setMic('starting');
      },
      onError: (error) => {
        if (hold.current !== thisHold) return;
        hold.current = null;
        listening.current?.abort();
        listening.current = null;
        dropRecording();
        setNotice(error.message);
        failed.current?.();
      },
    });
    if (!started.ok) {
      hold.current = null;
      setNotice(started.error.message);
      return false;
    }
    listening.current = started.session;
    setMode(started.session.mode);
    setMic('starting');
    setFellBack(false);
    setInput(undefined);
    setTranscript('');
    if (recordHold && !choosing) startRecording();
    return true;
  }, [record, dropRecording]);

  /** Lets go: waits for the recogniser's last words and hands back what was said. */
  const finish = useCallback(async (): Promise<Released> => {
    const session = listening.current;
    if (!session) return { status: 'idle' };
    listening.current = null;
    hold.current = null;
    buzz(15);
    const held = recording.current;
    recording.current = null;
    const voice = held ? stopRecording(held) : Promise.resolve(undefined);
    const result = await session.stop();
    if (!result.text.trim()) {
      setNotice(result.ok ? 'No speech was heard.' : result.error.message);
      return { status: 'empty' };
    }
    return { status: 'heard', text: result.text, recording: await voice };
  }, []);

  /** Drops the hold without a result. True when there was a hold to drop. */
  const drop = useCallback((): boolean => {
    hold.current = null;
    dropRecording();
    if (!listening.current) return false;
    listening.current.abort();
    listening.current = null;
    return true;
  }, [dropRecording]);

  return {
    transcript,
    notice,
    setNotice,
    mode,
    mic,
    fellBack,
    input,
    supported: isListenSupported(),
    begin,
    finish,
    drop,
  };
}

async function stopRecording(held: HeldRecording): Promise<Recording | undefined> {
  if (!(await held.started)) return undefined;
  try {
    return await held.recorder.stop();
  } catch {
    return undefined;
  }
}
