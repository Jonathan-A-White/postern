// src/cockpit/useDraft.ts — what he is typing in a composer survives the lock screen and a reload
// (mw-gq6.250). The door replaces the whole Shell when the key locks, so the composer is unmounted
// and its state is gone: the words are kept on the phone (src/data/repositories/drafts-repo.ts),
// written once he stops typing, and put back when a composer opens on the same channel.
import { useEffect, useRef, useState } from 'react';
import { draftsRepo } from '../data/repositories';

/** How long after the last keystroke the draft is written. */
export const DRAFT_SAVE_MS = 500;

/**
 * Keeps `text` as the draft under `key`. `restore` is called once, with the saved words, when the
 * composer opens empty. A `prefill` (Run on a prompt) is his choice of the moment and is not kept.
 * `discard` removes the draft at once: call it when the words have been sent.
 */
export function useDraft(key: string, text: string, restore: (saved: string) => void, prefill?: string): { discard: () => void } {
  const [loaded, setLoaded] = useState(false);
  // what is stored now, so an unchanged text writes nothing
  const stored = useRef('');
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void draftsRepo.get(key).then((saved) => {
      if (!current) return;
      stored.current = saved ?? '';
      if (saved && !prefill) restore(saved);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
    // only when it opens: the caller keys the composer by its channel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    latest.current = text;
    if (!loaded || text === stored.current || (prefill && text === prefill)) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      stored.current = text;
      void draftsRepo.save(key, text);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(timer.current);
  }, [key, text, loaded, prefill]);

  // leaving inside the window (the lock screen comes up) keeps the words too
  useEffect(
    () => () => {
      if (!loaded || latest.current === stored.current) return;
      stored.current = latest.current;
      void draftsRepo.save(key, latest.current);
    },
    [key, loaded],
  );

  function discard() {
    clearTimeout(timer.current);
    timer.current = undefined;
    stored.current = '';
    void draftsRepo.clear(key);
  }

  return { discard };
}
