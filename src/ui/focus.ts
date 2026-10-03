// src/ui/focus.ts — focus without scrolling. A focus() that is allowed to scroll can push the whole
// page up under the status bar on a phone (mw-jkrnxu.2), so every focus in the app goes through here.

/** Focuses the box and leaves the scroll position alone. */
export function focusQuietly(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}

/** A ref callback that focuses the box when it mounts: autoFocus, minus the scroll. */
export function focusOnMount(el: HTMLElement | null): void {
  focusQuietly(el);
}
