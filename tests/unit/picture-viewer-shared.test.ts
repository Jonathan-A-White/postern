// mw-t49ebj.3: Postern's picture viewer is pwa-kit/picture-viewer's; there is no second copy of the viewer,
// its history hook, Save or the zoom maths in src/, and both places that open a picture draw the kit's
// viewer with Save named for Postern.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clampPan, clampScale, pinchScale } from 'pwa-kit/picture-viewer';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the shared picture viewer', () => {
  it('has no copy of its own in src/cockpit', () => {
    for (const file of ['ImageViewer.tsx', 'zoom.ts', 'useViewer.ts', 'savePicture.ts']) {
      expect(existsSync(`src/cockpit/${file}`), file).toBe(false);
    }
  });

  it('is the only place the zoom maths is written', () => {
    const own = sources('src').filter((file) => /export function (clampScale|pinchScale|clampPan)\b/.test(readFileSync(file, 'utf8')));
    expect(own).toEqual([]);
    expect(clampScale(99)).toBe(6);
    expect(pinchScale(1, 100, 300)).toBe(3);
    expect(clampPan(1000, 2, 400)).toBeLessThan(1000);
  });

  it('is what the conversation and the composer open a picture in', () => {
    for (const file of ['src/cockpit/Conversation.tsx', 'src/cockpit/Composer.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/PosternPictureViewer|from 'pwa-kit\/picture-viewer'/);
    }
  });

  it('saves a nameless picture as postern and the day', () => {
    expect(readFileSync('src/cockpit/PosternPictureViewer.tsx', 'utf8')).toMatch(/savePicture\([^)]*'postern'\)/);
  });
});
