// src/services/idleHold.ts — a hold on the phone (the wake lock, the silent loop) that
// lets go by itself after TALK_IDLE_MS with no hold, answer or tap, and takes itself
// again when one comes (mw-1ox07o.1). A screen kept lit for an hour of silence is the
// largest power draw the app has; it must not outlast the talk that wanted it.

/** How long an open talk keeps the phone awake with nothing happening. */
export const TALK_IDLE_MS = 5 * 60_000;

export interface IdleHold {
  /** Something happened: take the hold again if it was let go, and start the wait over. */
  rearm(): void;
  /** Let go for good. */
  release(): void;
}

/** Takes `acquire`'s hold now and lets it go after `idleMs` unless `rearm` is called first. */
export function holdWhileActive(acquire: () => () => void, idleMs: number = TALK_IDLE_MS): IdleHold {
  let letGo: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const drop = () => {
    const release = letGo;
    letGo = undefined;
    release?.();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(drop, idleMs);
  };

  letGo = acquire();
  arm();
  return {
    rearm() {
      if (done) return;
      if (!letGo) letGo = acquire();
      arm();
    },
    release() {
      done = true;
      clearTimeout(timer);
      drop();
    },
  };
}
