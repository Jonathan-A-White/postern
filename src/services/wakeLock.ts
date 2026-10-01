// src/services/wakeLock.ts — keeps the screen awake while a talk is open (the
// Screen Wake Lock API). The browser drops the lock whenever the page is hidden,
// so it is asked for again when the page returns. A browser without the API, or one
// that refuses, simply lets the screen sleep: nothing here may break a talk.

interface Sentinel {
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

function api(): WakeLockApi | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
}

/** Holds the screen awake until the returned function is called. */
export function holdAwake(): () => void {
  let held: Sentinel | undefined;
  let wanted = true;

  const acquire = () => {
    const wakeLock = api();
    if (!wakeLock || !wanted || held) return;
    wakeLock
      .request('screen')
      .then((sentinel) => {
        if (wanted) held = sentinel;
        else void sentinel.release().catch(() => undefined);
      })
      .catch(() => undefined);
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      const old = held;
      held = undefined;
      if (old) void old.release().catch(() => undefined);
      acquire();
    }
  };

  acquire();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    wanted = false;
    document.removeEventListener('visibilitychange', onVisible);
    const sentinel = held;
    held = undefined;
    if (sentinel) void sentinel.release().catch(() => undefined);
  };
}
