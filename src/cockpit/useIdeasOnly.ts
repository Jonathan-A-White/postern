// src/cockpit/useIdeasOnly.ts — Ideas only as a screen reads it: the answer the phone kept (so it
// shows with no network), asked for again on open, and saving a change. The stream's ideas-only
// event for this key lands in the same kept answer (src/services/live.ts), so a screen re-renders by itself.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsRepo } from '../data/repositories';
import type { IdeasOnlyKept, IdeasOnlySetting } from '../model/ideasOnly';
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

export function useIdeasOnly(): IdeasOnlyView {
  const key = useUnlockedKey();
  const keyHex = useMemo(() => (key ? publicKeyHexFromMasterKey(key) : null), [key]);
  const stored = useLiveQuery<IdeasOnlyKept | null>(() => settingsRepo.getIdeasOnly().then((row) => row ?? null), [], null, 'ideasOnly');
  const kept = stored && stored.key === keyHex ? stored : undefined;
  // What the backend last said is remembered, so a screen that mounts again is as tall as it was (the scroll memory restores into it).
  const [availability, setAvailabilityNow] = useState<IdeasOnlyAvailability>(() => recallRead<IdeasOnlyAvailability>(AVAILABILITY_NAME).value ?? 'checking');
  const setAvailability = useCallback((next: IdeasOnlyAvailability) => {
    rememberRead(AVAILABILITY_NAME, next);
    setAvailabilityNow(next);
  }, []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

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
    [key, setAvailability],
  );

  return { kept, availability, saving, saveError, save };
}
