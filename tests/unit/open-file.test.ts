// tests/unit/open-file.test.ts — mw-azvrhbq: an attached PDF or text file opens in a tab on a tap, and has a Save beside it that
// downloads it under its attachment name; any other file still downloads on the tap itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserShows, hasSave, openFile, saveFile } from '../../src/cockpit/openFile';

afterEach(() => vi.restoreAllMocks());

function spyDownloads(): { name: string; href: string; rel: string }[] {
  const saved: { name: string; href: string; rel: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, href: this.href, rel: this.rel });
  });
  return saved;
}

describe('openFile', () => {
  it.each([
    ['application/pdf', 'plan.pdf'],
    ['text/plain', 'notes.txt'],
  ])('still opens %s in a new tab and saves nothing', (mime, name) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const saved = spyDownloads();
    openFile('blob:file', mime, name);
    expect(open).toHaveBeenCalledWith('blob:file', '_blank', 'noopener');
    expect(saved).toEqual([]);
  });

  it('downloads a file the browser does not show, under its name', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const saved = spyDownloads();
    openFile('blob:file', 'application/zip', 'data.zip');
    expect(open).not.toHaveBeenCalled();
    expect(saved).toEqual([{ name: 'data.zip', href: 'blob:file', rel: 'noopener' }]);
  });
});

describe('saveFile', () => {
  it('saves a PDF under its attachment name, without opening a tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const saved = spyDownloads();
    saveFile('blob:pdf', 'plan.pdf');
    expect(saved).toEqual([{ name: 'plan.pdf', href: 'blob:pdf', rel: 'noopener' }]);
    expect(open).not.toHaveBeenCalled();
  });

  it('names a nameless file "file"', () => {
    const saved = spyDownloads();
    saveFile('blob:x', undefined);
    expect(saved.map((s) => s.name)).toEqual(['file']);
  });
});

describe('hasSave', () => {
  it('is true for the types that open in a tab and have no other way to be saved', () => {
    expect(hasSave('application/pdf')).toBe(true);
    expect(hasSave('text/plain')).toBe(true);
  });

  it('is false for a file a tap already downloads, and for a picture and a recording (the viewer and the player)', () => {
    for (const mime of ['application/zip', 'application/octet-stream', 'text/markdown', 'image/png', 'audio/webm']) expect(hasSave(mime)).toBe(false);
    expect(browserShows('image/png')).toBe(true);
  });
});
