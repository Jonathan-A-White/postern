// src/cockpit/useIdeasOnly.ts — Ideas only as a screen reads it: the answer the phone kept (so it
// shows with no network), asked for again on open, and saving a change. The stream's ideas-only
// event for this key lands in the same kept answer (src/services/live.ts), so a screen re-renders by itself.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsRepo } from '../data/repositories';
import { onUntil, recordedWords, type IdeasOnlyKept, type IdeasOnlySetting } from '../model/ideasOnly';
import { useNow } from '../ui/useNow';
import { useAlive } from '../ui/useAlive';
import { getIdeasOnly, putIdeasOnly } from '../services/ideasOnly';
import { publicKeyHexFromMasterKey } from '../services/vault';
import { useLiveQuery, useUnlockedKey } from './hooks';
import { recallRead, rememberRead } from './lastKnown';

/** Whether the backend has been heard on this open: checking, answered, too old to have it, or not reached. */
export type IdeasOnlyAvailability = 'checking' | 'ok' | 'older' | 'offline';

export interface IdeasOnlyView {
  /** The last answer kept for this phone's key, if any. */
  kept: IdeasOnlyKept | undefined;
  availability: IdeasOnlyAvailability;
  saving: boolean;
  /** Why the last save did not happen, in words; cleared by the next save. */
  saveError: string | undefined;
  /** Replaces the whole setting; whether it was saved. */
  save: (next: IdeasOnlySetting) => Promise<boolean>;
}

const AVAILABILITY_NAME = 'ideasOnlyAvailability';

/** The answer the phone kept for this phone's key, if any; it changes by itself when the stream's event or an ask lands. */
function useKept(): IdeasOnlyKept | undefined {
  const key = useUnlockedKey();
  const keyHex = useMemo(() => (key ? publicKeyHexFromMasterKey(key) : null), [key]);
  const stored = useLiveQuery<IdeasOnlyKept | null>(() => settingsRepo.getIdeasOnly().then((row) => row ?? null), [], null, 'ideasOnly');
  return stored && stored.key === keyHex ? stored : undefined;
}

/** Longest a timer can wait (setTimeout keeps its delay in 32 bits). */
const MAX_WAIT_MS = 2 ** 31 - 1;

/**
 * Whether Ideas only is on for this phone's key right now, read from the kept answer and the phone's clock
 * (no network): it turns off by itself when the stream's event lands, or when the clock reaches the end.
 * Undefined when off; else the end in Unix seconds and the time it was read at.
 */
export function useIdeasOnlyNow(): { until: number; nowMs: number } | undefined {
  const kept = useKept();
  const nowMs = useNow(30_000);
  const until = kept?.state.on ? kept.state.until : 0;
  // The end passing is noticed at the end, not at the next tick of the shared clock.
  const [passed, setPassed] = useState(0);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setPassed(until), Math.min(MAX_WAIT_MS, Math.max(0, until * 1000 - Date.now())));
    return () => clearTimeout(timer);
  }, [until]);
  const end = passed === until ? undefined : onUntil(kept, nowMs);
  return end === undefined ? undefined : { until: end, nowMs };
}

/** 'Recorded for after 21:00' while the mode is on, else undefined: what a send says under itself, and a tap in place of 'waiting'. */
export function useRecordedWords(): string | undefined {
  const on = useIdeasOnlyNow();
  return on ? recordedWords(on.until, on.nowMs) : undefined;
}

export function useIdeasOnly(): IdeasOnlyView {
  const key = useUnlockedKey();
  const kept = useKept();
  // What the backend last said is remembered, so a screen that mounts again is as tall as it was (the scroll memory restores into it).
  const [availability, setAvailabilityNow] = useState<IdeasOnlyAvailability>(() => recallRead<IdeasOnlyAvailability>(AVAILABILITY_NAME).value ?? 'checking');
  const setAvailability = useCallback((next: IdeasOnlyAvailability) => {
    rememberRead(AVAILABILITY_NAME, next);
    setAvailabilityNow(next);
  }, []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const alive = useAlive();

  useEffect(() => {
    if (!key) return;
    let gone = false; // an answer that lands after the screen is gone sets no state
    void getIdeasOnly(key).then((answer) => {
      if (!gone) setAvailability(answer.ok ? 'ok' : answer.reason === 'older' ? 'older' : 'offline');
    });
    return () => {
      gone = true;
    };
  }, [key, setAvailability]);

  const save = useCallback(
    async (next: IdeasOnlySetting): Promise<boolean> => {
      if (!key) return false;
      setSaving(true);
      setSaveError(undefined);
      const answer = await putIdeasOnly(key, next);
      // the screen that asked has closed: what the backend said is for the next one to read (mw-ev7oyy.21)
      if (!alive()) return answer.ok;
      setSaving(false);
      if (answer.ok) {
        setAvailability('ok');
        return true;
      }
      if (answer.reason === 'older') setAvailability('older');
      setSaveError(
        answer.reason === 'unreachable' ? 'Could not be saved: the backend could not be reached. Nothing changed.' : answer.reason === 'older' ? answer.message : `Could not be saved: ${answer.message}`,
      );
      return false;
    },
    [key, setAvailability, alive],
  );

  return { kept, availability, saving, saveError, save };
}
