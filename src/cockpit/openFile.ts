// src/cockpit/openFile.ts — what a tap on an attached file does (mw-jtzpw0.5): a type the browser
// shows (a PDF, plain text) opens in a new tab; any other file downloads under its own name. A
// picture is not here: it opens in the full-screen viewer (ImageViewer.tsx).

/** Whether a type is shown by the browser itself (a picture, a recording, a PDF, plain text). */
export function browserShows(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('audio/') || mime === 'application/pdf' || mime === 'text/plain';
}

/** Saves an object URL as a file of this name. */
export function download(url: string, name: string | undefined): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name ?? 'file';
  link.rel = 'noopener';
  link.click();
}

/** Opens an object URL in a new tab when the browser shows its type, else downloads it as `name`. */
export function openFile(url: string, mime: string, name: string | undefined): void {
  if (browserShows(mime)) window.open(url, '_blank', 'noopener');
  else download(url, name);
}
