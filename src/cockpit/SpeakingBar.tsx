// src/cockpit/SpeakingBar.tsx — mw-q6n8m0.9: the one bar for anything read aloud: Pause (Resume while paused), Restart and
// Stop, each 44 px high, shown while something speaks or waits paused. In flow, never over text. The Shell shows it for
// every read-aloud button, and for the Mayor's answer once the Talk line is left (it waits paused there); on the Talk line
// itself the answer carries its own buttons beside its speaker (mw-q6n8m0.11). The bar is bsv-kit's packages/speech
// (mw-m7v5kc.2); Postern's colours for it are the --bk-speech-* properties in index.css.
export { SpeakingBar, type SpeakingBarProps } from 'bsv-kit/speech/react';
