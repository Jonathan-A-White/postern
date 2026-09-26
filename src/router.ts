// src/router.ts — mw-tfne4.28: every screen link is authored as a bare
// `?screen=...` query string (src/App.tsx picks the screen from the URL), and
// until now a click on one was a full page load. That reset services/keySession.ts's
// module-level shared key (mw-tfne4.23) on every single move between screens, so
// the 15-minute shared unlock never actually carried anywhere. Intercepting a
// same-origin `?screen=` link into history.pushState keeps the same page (and the
// same module instance) across a screen change; a link elsewhere, or opened in a
// new tab, is untouched.
//
// mw-tfne4.29: every screen's own "Back" link points at the bare root ('/'),
// which App.tsx also renders with no page load (an empty search shows the
// Gate) — so that link is routed the same way as a `?screen=` link.
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return window.location.search;
}

/** The current screen's query string, live across both a `?screen=` link
 * (handleScreenLinkClick) and the browser's Back/Forward (popstate) — App
 * re-renders the screen the URL now names, no page load either way. */
export function useScreenSearch(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isRoutableHref(href: string): boolean {
  return href.startsWith('?screen=') || href === '/' || href.startsWith('/?');
}

function handleScreenLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || !isPlainLeftClick(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor) return;
  if (anchor.target && anchor.target !== '_self') return;

  const href = anchor.getAttribute('href');
  if (!href || !isRoutableHref(href)) return;

  event.preventDefault();
  window.history.pushState(null, '', href);
  emitChange();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleScreenLinkClick);
  window.addEventListener('popstate', emitChange);
}
