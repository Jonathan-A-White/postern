// src/cockpit/holdBar.ts — Postern's theme for the hold-to-talk bar that comes from voice-kit/composer
// (mw-jtzpw0.2). The package draws the bar with class names and data-state only; these are Postern's
// colours and sizes for it, so a hold looks the same in the composer and on the Talk line as it did
// when the bar lived in this repo. POSTERN_COMPOSER_SETTINGS is what the compose bar and the Talk line's bar are
// set to (mw-06ggew.5).
import type { ComposerSettings } from 'voice-kit/composer';

/** What the package's recogniser messages call the app, where they say how to allow the microphone. */
export const APP_NAME = 'Postern';

/** The hold bar: accent at rest, 'needs' while held, danger while the finger is slid off it. */
export const HOLD_BAR_CLASS = [
  'flex h-[min(6rem,16dvh)] min-h-12 w-full max-w-xl touch-none flex-col items-center justify-center gap-1 rounded-3xl text-[16px] font-semibold transition-colors select-none [-webkit-touch-callout:none]',
  'bg-accent text-accent-fg',
  'data-[state=listening]:bg-needs data-[state=listening]:text-canvas',
  'data-[state=slid]:bg-danger data-[state=slid]:text-canvas',
  'disabled:cursor-not-allowed disabled:opacity-45',
].join(' ');

/** The compose bar's and the Talk line's choices: hold to talk, send on release, and typing, attach, camera and a voice note on. */
export const POSTERN_COMPOSER_SETTINGS: ComposerSettings = {
  talk: 'hold',
  send: 'release',
  type: true,
  attach: true,
  camera: true,
  voiceNote: true,
};
