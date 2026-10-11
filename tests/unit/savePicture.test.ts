// tests/unit/savePicture.test.ts — mw-jtzpw0.7: the name a saved picture gets, and the share sheet's
// answers when the phone's links do not download.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pictureName, savePicture } from '../../src/cockpit/savePicture';

const anchorDownload = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download') as PropertyDescriptor;

function shareSheetThat(share: (data: ShareData) => Promise<void>, canShare: (data: ShareData) => boolean = () => true): void {
  Reflect.deleteProperty(HTMLAnchorElement.prototype, 'download');
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }));
}

afterEach(() => {
  Object.defineProperty(HTMLAnchorElement.prototype, 'download', anchorDownload);
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  vi.unstubAllGlobals();
});

describe('pictureName', () => {
  const day = new Date('2026-10-10T00:25:00Z');

  it('keeps the attachment its own file name', () => {
    expect(pictureName('receipt.jpg', 'image/jpeg', day)).toBe('receipt.jpg');
  });

  it('names a nameless picture postern and the date, jpg unless its type says otherwise', () => {
    expect(pictureName(undefined, undefined, day)).toBe('postern-2026-10-10.jpg');
    expect(pictureName(undefined, 'image/jpeg', day)).toBe('postern-2026-10-10.jpg');
    expect(pictureName('', 'image/png', day)).toBe('postern-2026-10-10.png');
  });
});

describe('savePicture without a download', () => {
  it('backing out of the share sheet is not a failure', async () => {
    shareSheetThat(async () => {
      throw new DOMException('Share canceled', 'AbortError');
    });
    expect(await savePicture('blob:p', 'wall.png', 'image/png')).toEqual({ saved: 'cancelled', file: 'wall.png' });
  });

  it('a share sheet that refuses files, or fails, did not save it', async () => {
    shareSheetThat(async () => {}, () => false);
    expect((await savePicture('blob:p', 'wall.png', 'image/png')).saved).toBe('failed');
    shareSheetThat(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    });
    expect((await savePicture('blob:p', 'wall.png', 'image/png')).saved).toBe('failed');
  });
});
