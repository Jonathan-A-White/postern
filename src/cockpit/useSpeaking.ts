// src/cockpit/useSpeaking.ts — mw-ym1qi9.1: whether the speech started under `key` is reading now, so a speaker button
// can turn into Stop while it reads and back when it ends. A screen that is left pauses the speech it started (his words,
// mw-q6n8m0.10): the Shell's speaking bar offers Resume on the next screen and the button says Stop again when he comes
// back; only a new speech or Stop ends it. The hook and useSpeech (what is speaking now, mw-q6n8m0.9) are bsv-kit's
// packages/speech (mw-m7v5kc.2), the same speech the services/speech wrappers start.
export { useSpeaking, useSpeech } from 'bsv-kit/speech/react';
