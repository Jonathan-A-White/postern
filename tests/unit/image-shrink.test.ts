// tests/unit/image-shrink.test.ts — mw-7dige5.2: a picture is cut to at most 2400 px on its long edge and re-encoded as a JPEG
// before it is sent; the canvas is behind imageSeam, so a fake encoder stands in here (jsdom has no canvas).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JPEG_QUALITY, MAX_EDGE, fitWithin, imageSeam, prepareImage } from '../../src/images/shrink';

const picture = (type: string, bytes: number, name = 'p') => new File([new Uint8Array(bytes)], name, { type });

/** A decoder that reports `width` x `height` and an encoder that returns `encoded` bytes, remembering what it was asked. */
function fakeSeam(width: number, height: number, encoded: number) {
  const encode = vi.fn<typeof imageSeam.encode>(async () => new Blob([new Uint8Array(encoded)], { type: 'image/jpeg' }));
  vi.spyOn(imageSeam, 'decode').mockResolvedValue({ width, height, source: null });
  vi.spyOn(imageSeam, 'encode').mockImplementation(encode);
  return encode;
}

afterEach(() => vi.restoreAllMocks());

describe('fitWithin', () => {
  it('cuts a 4000x3000 photo to 2400x1800', () => {
    expect(fitWithin(4000, 3000, MAX_EDGE)).toEqual({ width: 2400, height: 1800 });
  });
  it('cuts a portrait photo by its height', () => {
    expect(fitWithin(3000, 4000, MAX_EDGE)).toEqual({ width: 1800, height: 2400 });
  });
  it('keeps a 1080x2400 screenshot as it is', () => {
    expect(fitWithin(1080, 2400, MAX_EDGE)).toEqual({ width: 1080, height: 2400 });
  });
  it('never makes a small picture bigger', () => {
    expect(fitWithin(800, 600, MAX_EDGE)).toEqual({ width: 800, height: 600 });
  });
  it('never rounds a thin picture down to nothing', () => {
    expect(fitWithin(24000, 3, MAX_EDGE).height).toBe(1);
  });
  it('is 2400 px', () => {
    expect(MAX_EDGE).toBe(2400);
  });
});

describe('prepareImage', () => {
  it('turns a 4000x3000 photo into 2400x1800 at quality 0.85', async () => {
    const encode = fakeSeam(4000, 3000, 500);
    const out = await prepareImage(picture('image/jpeg', 5000));
    expect(encode).toHaveBeenCalledWith(expect.anything(), 2400, 1800, JPEG_QUALITY);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBe(500);
  });

  it('keeps a 1080x2400 screenshot at 1080x2400 and re-encodes it', async () => {
    const encode = fakeSeam(1080, 2400, 500);
    const out = await prepareImage(picture('image/png', 5000));
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1080, 2400, JPEG_QUALITY);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBe(500);
  });

  it('sends the original when the encode comes out bigger', async () => {
    fakeSeam(1080, 2400, 6000);
    const original = picture('image/png', 5000);
    expect(await prepareImage(original)).toBe(original);
  });

  it('sends the original when the encode comes out the same size', async () => {
    fakeSeam(1080, 2400, 5000);
    const original = picture('image/png', 5000);
    expect(await prepareImage(original)).toBe(original);
  });

  it('handles a webp picture', async () => {
    fakeSeam(3000, 2000, 100);
    expect((await prepareImage(picture('image/webp', 5000))).type).toBe('image/jpeg');
  });

  it.each(['image/gif', 'audio/webm', 'application/pdf', 'text/plain', 'application/octet-stream'])('leaves a %s file untouched', async (type) => {
    const encode = fakeSeam(4000, 3000, 1);
    const decode = vi.mocked(imageSeam.decode);
    const original = picture(type, 5000);
    expect(await prepareImage(original)).toBe(original);
    expect(decode).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it('sends the original when the phone cannot decode or encode the picture', async () => {
    vi.spyOn(imageSeam, 'decode').mockRejectedValue(new Error('no'));
    const original = picture('image/jpeg', 5000);
    expect(await prepareImage(original)).toBe(original);
  });
});
