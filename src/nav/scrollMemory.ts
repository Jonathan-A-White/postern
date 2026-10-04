// src/nav/scrollMemory.ts — Back (and the tab bar) bring him to where he was reading
// (mw-f758y.35). Each scrolling box keeps its offset in memory, keyed by the screen's address
// and a name for the box, and puts it back when the box is shown again at that address. The
// memory lasts for the page's life: opening an address cold (a push, a link into a closed app)
// has none, so it lands where the screen puts it, as before. The one exception is the address he
// was last at: its offsets are also kept on the phone (src/nav/lastRoute.ts, mw-f758y.31), so closing
// the app and opening it again puts him back at the same place on the same screen.
import { useEffect, useState } from 'react';
import { useScreenSearch } from '../router';
import { readScrolls, saveScrolls } from './lastRoute';

const offsets = new Map<string, number>();

/** How long after the last scroll event the offsets are written to the phone. */
const KEEP_AFTER_MS = 250;
let keepTimer: ReturnType<typeof setTimeout> | undefined;

function keepNow(): void {
  clearTimeout(keepTimer);
  keepTimer = undefined;
  saveScrolls(offsets, window.location.search);
}

function keepSoon(): void {
  if (keepTimer === undefined) keepTimer = setTimeout(keepNow, KEEP_AFTER_MS);
}

if (typeof document !== 'undefined') {
  window.addEventListener('pagehide', keepNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') keepNow();
  });
}

/** Called once before the first render: the offsets kept for the address the app opens at. */
export function restoreScrolls(): void {
  for (const [key, top] of readScrolls(window.location.search)) offsets.set(key, top);
}

/** How long a restore keeps waiting for the content behind it to arrive. */
const RESTORE_WAIT_MS = 2500;

function scrollBoxTo(box: HTMLElement, top: number): void {
  box.scrollTop = top;
}

/** Forget every remembered position. */
export function forgetScrolls(): void {
  offsets.clear();
}

/** Give the returned ref to a scrolling box. `slot` names the box on its screen; with
 * `perRoute` false the position is kept for the slot alone, whatever the address (a list
 * that stays beside the pane an address opens). */
export function useScrollMemory(slot: string, perRoute = true): (el: HTMLElement | null) => void {
  const search = useScreenSearch();
  const key = perRoute ? `${search}#${slot}` : slot;
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const box: HTMLElement = el;
    const target = offsets.get(key);
    // Until the box reaches the remembered offset (its content may still be arriving), its own
    // scroll events are not him moving it, so they are not remembered.
    let restoring = target !== undefined;
    let observer: ResizeObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      restoring = false;
      observer?.disconnect();
      clearTimeout(timer);
    };
    const restore = () => {
      if (!restoring || target === undefined) return;
      scrollBoxTo(box, target);
      if (Math.abs(box.scrollTop - target) < 1) settle();
    };
    const onScroll = () => {
      if (restoring) return;
      offsets.set(key, box.scrollTop);
      keepSoon();
    };
    // His own hand on the box ends the restore: where he puts it is where it stays.
    const interrupt = () => settle();

    box.addEventListener('scroll', onScroll, { passive: true });
    const touches = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const type of touches) box.addEventListener(type, interrupt, { passive: true });

    if (restoring) {
      restore();
      if (restoring) {
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(restore);
          observer.observe(box.firstElementChild ?? box);
        }
        timer = setTimeout(settle, RESTORE_WAIT_MS);
      }
    }

    return () => {
      settle();
      box.removeEventListener('scroll', onScroll);
      for (const type of touches) box.removeEventListener(type, interrupt);
    };
  }, [el, key]);

  return setEl;
}
