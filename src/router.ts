// src/router.ts — moves between the cockpit's places without a page load. Every
// in-app link is a bare query string (`?v=…`, src/nav/route.ts; older `?screen=`
// links too) or the root; a plain click on one becomes history.pushState, so
// the unlocked key (src/services/keySession.ts) and the live connection
// (src/services/live.ts) carry across. Back and Forward re-render the same way.
import { useSyncExternalStore } from 'react';
import { formatRoute, parseRoute, type Route } from './nav/route';

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

/** The current query string, live across in-app links and Back/Forward. */
export function useScreenSearch(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useRoute(): Route {
  return parseRoute(useScreenSearch());
}

export function navigate(route: Route | string, options: { replace?: boolean } = {}): void {
  const target = typeof route === 'string' ? route : formatRoute(route);
  if (options.replace) window.history.replaceState(window.history.state, '', target);
  else window.history.pushState({ app: true }, '', target);
  emitChange();
}

/** Back within the app when the current entry was reached by an in-app move;
 * otherwise (opened from a notification or a bookmark) up to `fallback`. */
export function goBack(fallback: Route): void {
  const state = window.history.state as { app?: boolean } | null;
  if (state?.app) {
    window.history.back();
    return;
  }
  navigate(fallback, { replace: true });
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isRoutableHref(href: string): boolean {
  return href.startsWith('?') || href === '/' || href.startsWith('/?');
}

function handleScreenLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || !isPlainLeftClick(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor) return;
  if (anchor.target && anchor.target !== '_self') return;

  const hrefValue = anchor.getAttribute('href');
  if (!hrefValue || !isRoutableHref(hrefValue)) return;

  event.preventDefault();
  window.history.pushState({ app: true }, '', hrefValue);
  emitChange();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleScreenLinkClick);
  window.addEventListener('popstate', emitChange);
}
