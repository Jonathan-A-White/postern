// src/cockpit/lastKnown.ts — what each remembered live query (hooks.ts useLiveQuery) last read, by
// name (mw-v1uyku.2). A screen that mounts again while the phone is busy (the sync after a dropped
// stream is writing, so its read waits its turn) starts from this instead of from empty: the channel
// list, a channel's posts and Needs you never blank because the connection is down.
const lastKnown = new Map<string, unknown>();

export function rememberRead(name: string, value: unknown): void {
  lastKnown.set(name, value);
}

/** The named read as it last came, or undefined (with `known` false) when it has not been read yet. */
export function recallRead<T>(name: string): { known: boolean; value?: T } {
  return lastKnown.has(name) ? { known: true, value: lastKnown.get(name) as T } : { known: false };
}

/** Drops everything remembered: a test starts from a phone that has read nothing. */
export function forgetLastKnown(): void {
  lastKnown.clear();
}
