// src/images/shrink.ts — a picture is cut down on the phone before it is sent (mw-7dige5.2): at most 2400 px on the long edge,
// re-encoded as a JPEG at quality 0.85, so a phone screenshot keeps its full size and stays sharp while a camera photo shrinks.
// The canvas work is behind imageSeam so a test, in jsdom with no canvas, replaces it.

/** The long edge a sent picture has at most (px). */
export const MAX_EDGE = 2400;
/** The JPEG quality a sent picture is encoded at (0 to 1). */
export const JPEG_QUALITY = 0.85;

/** The pictures that are re-encoded; a GIF (it may move), a voice note or any other file is sent as it is. */
const SHRUNK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A picture the canvas can draw: its size and whatever the encoder needs to draw it. */
export interface Decoded {
  width: number;
  height: number;
  source: ImageBitmap | HTMLImageElement | null;
}

export const imageSeam = {
  /** Reads the file's pixels. */
  async decode(file: Blob): Promise<Decoded> {
    const source = await createImageBitmap(file);
    return { width: source.width, height: source.height, source };
  },
  /** Draws the picture at `width` x `height` on a canvas and encodes it as a JPEG of `quality` (0 to 1). */
  async encode(decoded: Decoded, width: number, height: number, quality: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context || !decoded.source) throw new Error('This phone cannot shrink the picture.');
    // JPEG has no transparency: a screenshot with some would turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('This phone cannot shrink the picture.');
    return blob;
  },
};

/** `width` x `height` with the long edge cut to `max`, the shape kept; a picture already within it is left as it is. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The picture to send: a JPEG of at most MAX_EDGE on the long edge, or the original when it is not a jpeg, png or webp, when the
 * phone cannot decode or encode it, or when the JPEG is not smaller than the original. */
export async function prepareImage<T extends Blob>(file: T): Promise<T | Blob> {
  if (!SHRUNK_TYPES.includes(file.type)) return file;
  try {
    const decoded = await imageSeam.decode(file);
    const size = fitWithin(decoded.width, decoded.height, MAX_EDGE);
    const encoded = await imageSeam.encode(decoded, size.width, size.height, JPEG_QUALITY);
    return encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  }
}
