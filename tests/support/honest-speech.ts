import { installSpeech, type Clock, type FakeVoice, type SpeechFake } from 'bsv-kit/testing/speech';

/**
 * bsv-kit/testing's honest speech synthesiser for a test (mw-it6qk5.4): it queues, starts an utterance a moment after
 * speak(), fires start, boundary and end after the time a spoken sentence takes, and reports a cancelled one as an error,
 * as Android Chrome does. It runs on a clock the test moves by hand, so real timers (Testing Library's waitFor, Dexie)
 * keep working. `advance(ms)` moves that clock; `finish()` lets what is speaking end and the next sentence begin.
 */
export interface ManualClock extends Clock {
  advance(ms: number): void;
}

export function manualClock(): ManualClock {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      next += 1;
      timers.set(next, { at: now + Math.max(0, ms), fn });
      return next;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = until;
    },
  };
}

/** A voice the phone lists, named by its language. */
export function voiceOf(lang: string): FakeVoice {
  return { voiceURI: lang, name: lang, lang, localService: true, default: false };
}

export interface HonestSpeech extends SpeechFake {
  clock: ManualClock;
  advance(ms: number): void;
  /** Lets the sentence that is speaking (or about to) end, and the next one begin. */
  finish(): void;
  /** Lets everything queued be heard to its end. */
  finishAll(): void;
  /** The sentences still to be heard: speaking, or queued behind it. */
  waiting(): string[];
}

export interface HonestSpeechOptions {
  /** What the phone lists once its voices load. Default: bsv-kit's English and Greek voices. */
  voices?: FakeVoice[];
  /** Leave the voice list empty (as a phone is just after the page opens); `loadVoices()` is `advance(50)`. Default: loaded at once. */
  voicesLate?: boolean;
}

export function installHonestSpeech(options: HonestSpeechOptions = {}): HonestSpeech {
  const clock = manualClock();
  const fake = installSpeech(window, { clock, ...(options.voices ? { voices: options.voices } : {}) });
  if (!options.voicesLate) clock.advance(fake.options.voicesDelayMs);
  const honest: HonestSpeech = Object.assign(fake, {
    clock,
    advance: (ms: number) => clock.advance(ms),
    finish() {
      const target = fake.log.find((entry) => entry.outcome === 'speaking' || entry.outcome === 'queued');
      if (!target) return;
      for (let spent = 0; target.outcome !== 'ended' && spent < 60_000; spent += 10) clock.advance(10);
      clock.advance(0);
    },
    finishAll() {
      for (let guard = 0; fake.log.some((entry) => entry.outcome === 'speaking' || entry.outcome === 'queued') && guard < 500; guard += 1) honest.finish();
    },
    waiting: () => fake.log.filter((entry) => entry.outcome === 'speaking' || entry.outcome === 'queued').map((entry) => entry.text),
  });
  return honest;
}

/**
 * Makes the phone's voice engine refuse every utterance it is handed (mw-lcirxg): the utterance never starts, and an
 * `error` event with `error` as its name (SpeechSynthesisErrorEvent: 'audio-busy', 'not-allowed', 'synthesis-failed'…)
 * reaches it a moment later, as Android Chrome does when a headset or the audio focus is not there. `advance(0)` delivers it.
 */
export function failSpeech(speech: HonestSpeech, error: string): void {
  speech.synth.speak = (utterance) => {
    speech.log.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, voice: null, queuedAt: 0, startedAt: null, endedAt: null, outcome: 'canceled' });
    speech.clock.setTimeout(() => utterance.dispatchEvent({ type: 'error', error } as { type: string }), 0);
  };
}
