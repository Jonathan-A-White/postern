// src/ui/useNow.ts — the time now, shared (mw-xhtcup.1). One store per interval length holds
// one clock for every subscriber: the first subscriber starts it, the last stops it, and while
// the page is hidden it does not tick (see setVisibleInterval); on return `now` is refreshed
// at once so every label is fresh.
import { useSyncExternalStore } from 'react';
import { setVisibleInterval } from './visibleInterval';

interface NowStore {
  now: number;
  /** No subscriber has kept `now` fresh: the next read stamps it again. */
  stale: boolean;
  listeners: Set<() => void>;
  stop?: () => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
}

const stores = new Map<number, NowStore>();

function storeFor(intervalMs: number): NowStore {
  let store = stores.get(intervalMs);
  if (store) return store;
  const made: NowStore = {
    now: Date.now(),
    stale: false,
    listeners: new Set(),
    subscribe(listener) {
      made.listeners.add(listener);
      if (made.listeners.size === 1) {
        made.stop = setVisibleInterval(() => {
          made.now = Date.now();
          for (const notify of [...made.listeners]) notify();
        }, intervalMs);
      }
      return () => {
        made.listeners.delete(listener);
        if (made.listeners.size === 0) {
          made.stop?.();
          made.stop = undefined;
          made.stale = true;
        }
      };
    },
    getSnapshot() {
      if (made.stale) {
        made.now = Date.now();
        made.stale = false;
      }
      return made.now;
    },
  };
  store = made;
  stores.set(intervalMs, store);
  return store;
}

/** Date.now(), re-read every `intervalMs` while the page is visible and shared by every caller. */
export function useNow(intervalMs: number): number {
  const store = storeFor(intervalMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
