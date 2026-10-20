// src/cockpit/talkSettings.ts — Me > Talk: the two choices that differ between people, kept on the device (localStorage)
// and read by the compose bar and the Talk line at once. Talk: Hold (hold the bar) or Tap (hold it, or tap to keep the mic
// on and tap again to stop). Send: On release (letting go sends) or By button (the words wait in the box, then Send).
// A phone that will not keep them shows the defaults, no harm. Attach, camera and the voice note stay the app's own
// (POSTERN_COMPOSER_SETTINGS).
import { useMemo, useSyncExternalStore } from 'react';
import type { ComposerSend, ComposerSettings } from 'voice-kit/composer';
import { POSTERN_COMPOSER_SETTINGS } from './holdBar';

const KEY = 'postern.talk';

export type TalkChoice = 'hold' | 'tap';

export interface TalkSettings {
  talk: TalkChoice;
  send: ComposerSend;
}

export const DEFAULT_TALK_SETTINGS: TalkSettings = { talk: 'hold', send: 'release' };

function parse(raw: string | null): TalkSettings {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '{}');
  } catch {
    stored = {};
  }
  const value = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return {
    talk: value.talk === 'tap' ? 'tap' : DEFAULT_TALK_SETTINGS.talk,
    send: value.send === 'button' ? 'button' : DEFAULT_TALK_SETTINGS.send,
  };
}

function rawNow(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readTalkSettings(): TalkSettings {
  return parse(rawNow());
}

const listeners = new Set<() => void>();

/** Hears every change to the settings, from this page or (the storage event) another tab; returns how to stop. */
export function onTalkSettings(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Keep `next` on the device and tell every bar listening. */
export function keepTalkSettings(next: TalkSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // see the top of the file
  }
  for (const listener of [...listeners]) listener();
}

/** What the compose bar and the Talk line's bar are set to: the app's own settings with his two choices over them. */
export function composerSettingsOf({ talk, send }: TalkSettings): ComposerSettings {
  return { ...POSTERN_COMPOSER_SETTINGS, talk, send };
}

let snapshot: { raw: string | null; settings: TalkSettings } | undefined;

/** The kept settings, the same object until the stored value changes (a store snapshot must not change on every read). */
function getSnapshot(): TalkSettings {
  const raw = rawNow();
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, settings: parse(raw) };
  return snapshot.settings;
}

/** His Talk and Send choices, live: the screen using it draws again the moment Me changes them. */
export function useTalkSettings(): TalkSettings {
  return useSyncExternalStore(onTalkSettings, getSnapshot, () => DEFAULT_TALK_SETTINGS);
}

/** The ComposerSettings for the bars, live; the same object until a choice changes. */
export function useComposerSettings(): ComposerSettings {
  const kept = useTalkSettings();
  return useMemo(() => composerSettingsOf(kept), [kept]);
}
