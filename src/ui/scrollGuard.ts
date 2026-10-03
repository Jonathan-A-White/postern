// src/ui/scrollGuard.ts — the page never scrolls (mw-jkrnxu.2). html, body, #root and the Shell root are
// overflow:clip, but the viewport itself still scrolls for a keyboard or a focus, and Android Chrome can
// leave it scrolled when the keyboard closes or the app comes back. Whatever scrolls them is put back at
// the top, on the scroll itself and on every event that is known to leave the page moved.

const GUARDED = '[data-shell]';

function guarded(): HTMLElement[] {
  const found: Array<Element | null> = [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll(GUARDED)];
  return found.filter((el): el is HTMLElement => el instanceof HTMLElement && el.scrollTop !== 0);
}

/** Puts the document, body and Shell root back at scrollTop 0. */
export function resetPageScroll(): void {
  for (const el of guarded()) el.scrollTop = 0;
  if (window.scrollY !== 0) window.scrollTo(0, 0);
}

/** Starts the guard; the returned function stops it. */
export function installScrollGuard(): () => void {
  const onScroll = (event: Event) => {
    const target = event.target;
    if (target === document || target === window || target === document.scrollingElement || (target instanceof Element && (target === document.body || target.matches(GUARDED)))) {
      resetPageScroll();
    }
  };
  const onChange = () => {
    resetPageScroll();
    // the keyboard finishes closing a frame or two after the event
    requestAnimationFrame(resetPageScroll);
  };
  const windowEvents = ['resize', 'focusout', 'pageshow'] as const;
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('visibilitychange', onChange);
  for (const name of windowEvents) window.addEventListener(name, onChange);
  window.visualViewport?.addEventListener('resize', onChange);
  return () => {
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('visibilitychange', onChange);
    for (const name of windowEvents) window.removeEventListener(name, onChange);
    window.visualViewport?.removeEventListener('resize', onChange);
  };
}
