// src/cockpit/savePicture.ts — Save in the full-screen picture viewer (mw-jtzpw0.7): the picture as
// it came, its own bytes and type at full size, onto the phone. A browser whose links download (an
// <a download>) saves it to Downloads, where the gallery finds it; only one that cannot hands the
// file to the share sheet (navigator.share), where Save Image puts it in Photos.
import { download } from './openFile';

/** What a tap on Save did: downloaded, shared, backed out of the share sheet, or neither could be done. */
export type Saved = 'downloaded' | 'shared' | 'cancelled' | 'failed';

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/** The picture's own file name, or postern-<date> with its type's extension (jpg when unknown). */
export function pictureName(name: string | undefined, type: string | undefined, now: Date = new Date()): string {
  if (name) return name;
  return `postern-${now.toISOString().slice(0, 10)}.${EXTENSIONS[type ?? ''] ?? 'jpg'}`;
}

/** Whether this browser's links download (feature detection: `download` on an <a>). */
export function canDownload(): boolean {
  return 'download' in HTMLAnchorElement.prototype;
}

/**
 * Saves the picture at the object URL `src`: by download where links download, else by the share
 * sheet. Says what it did and the file name it saved under.
 */
export async function savePicture(src: string, name: string | undefined, type: string | undefined): Promise<{ saved: Saved; file: string }> {
  const file = pictureName(name, type);
  return { saved: await saveAs(src, file, type), file };
}

async function saveAs(src: string, file: string, type: string | undefined): Promise<Saved> {
  if (canDownload()) {
    download(src, file);
    return 'downloaded';
  }
  if (typeof navigator.share !== 'function') return 'failed';
  try {
    const blob = await (await fetch(src)).blob();
    const files = [new File([blob], file, { type: blob.type || type || 'image/jpeg' })];
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files })) return 'failed';
    await navigator.share({ files });
    return 'shared';
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
