// src/services/listening.ts — how a hold of the Talk line and the composer listens: the browser's recogniser (voice-kit's
// browserSpeech), kept listening through a pause (mw-gq6.570).
//
// Android ends the recogniser by itself on a pause. voice-kit's listener then records the rest of the hold and, on release,
// plays that recording to a fresh recogniser (mw-q6n8m0.5, to spare the start tone at a restart). Android's speech service
// listens to the microphone itself and hears nothing in the recording, so the turn went with the words before the pause and
// 'The words after the pause could not be made out'. voice-kit takes the recording path only on a page that can record
// (window.MediaRecorder), so while a hold listens this page says it cannot: the listener starts the recogniser again
// when it ends, keeps the words before, and everything said while his finger is down is the turn. The cost is the start
// tone at each restart. A hold that records a voice note has its recorder open by then (the hold opens it before the
// recogniser starts), and an open recorder is not affected.
// Until voice-kit offers the choice itself (an option on its listener that turns the recorded rest off), this is the lever.
import { browserSpeech, type Transcriber } from 'voice-kit/composer';

let hiding = 0;
let hidden: PropertyDescriptor | undefined;

/** Makes window.MediaRecorder absent until the returned function is called (any number of holds may overlap). */
function hideRecorder(): () => void {
  if (typeof window === 'undefined' || !('MediaRecorder' in window)) return () => {};
  if (hiding++ === 0) {
    hidden = Object.getOwnPropertyDescriptor(window, 'MediaRecorder');
    Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true, writable: true, enumerable: false });
  }
  let given = false;
  return () => {
    if (given) return;
    given = true;
    if (--hiding > 0) return;
    if (hidden) Object.defineProperty(window, 'MediaRecorder', hidden);
    else delete (window as { MediaRecorder?: unknown }).MediaRecorder;
    hidden = undefined;
  };
}

export const listensThroughPauses: Transcriber = {
  supported: browserSpeech.supported,
  start(options) {
    let give: (() => void) | undefined;
    let over = false;
    const finish = () => {
      over = true;
      give?.();
      give = undefined;
    };
    const started = browserSpeech.start({
      ...options,
      onStart: () => {
        if (!over) give ??= hideRecorder();
        options.onStart?.();
      },
    });
    if (!started.ok) return started;
    const { session } = started;
    return {
      ok: true,
      session: {
        get mode() {
          return session.mode;
        },
        stop: () => session.stop().finally(finish),
        abort: () => {
          finish();
          session.abort();
        },
      },
    };
  },
};
