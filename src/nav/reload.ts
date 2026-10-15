// src/nav/reload.ts — the one place the page is reloaded, so a test can stand in for it (a jsdom page cannot reload).
export function reloadPage(): void {
  window.location.reload();
}
