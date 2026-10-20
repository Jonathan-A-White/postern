// src/cockpit/pickedFile.ts — a file he chose, ready to send: a picture is cut to 2400 px and re-encoded as a JPEG
// first (src/images/shrink.ts, mw-7dige5.2), and read into bytes with a local preview. The composer's attachments and
// the Talk line's one picture are made the same way, so a screenshot goes as the same blob wherever it is chosen.
// The compose bar is voice-kit's Composer (mw-06ggew.5), which keeps a file as it was chosen: its pictures are cut down
// on Send (toSent), the same way.
import { prepareImage } from '../images/shrink';
import type { OutgoingFile } from './send';

export interface PickedFile extends OutgoingFile {
  /** An object URL to draw it from, for a picture or a sound. */
  preview?: string;
}

/** `original` as it will be sent, named `name` (a picture re-encoded as a JPEG is named for what it now is). */
export async function toPicked(original: File | Blob, name: string): Promise<PickedFile> {
  const file = await prepareImage(original);
  const kept = file === original ? name : jpegName(name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || 'application/octet-stream';
  return { name: kept, type, bytes, preview: type.startsWith('image/') || type.startsWith('audio/') ? URL.createObjectURL(file) : undefined };
}

/** A picture's name once it is re-encoded as a JPEG. */
function jpegName(name: string): string {
  return name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
}

/** A file as it will be sent: a picture cut down and re-encoded as toPicked does it, any other file as it is. */
export async function toSent(file: OutgoingFile): Promise<OutgoingFile> {
  const original = new Blob([file.bytes as BlobPart], { type: file.type });
  const shrunk = await prepareImage(original);
  if (shrunk === original) return file;
  return { name: jpegName(file.name), type: shrunk.type, bytes: new Uint8Array(await shrunk.arrayBuffer()) };
}
