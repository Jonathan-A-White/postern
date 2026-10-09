// tests/unit/composer-package.test.ts — mw-jtzpw0.2: the hold-to-talk composer comes from bsv-kit's
// packages/composer, pinned at a commit, not from a copy in this repo. Postern keeps what is its own
// (drafts, saved prompts, quotes, shared-in files, the Talk line) and passes its theme in.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { dependencies: Record<string, string> };
const source = (path: string) => readFileSync(path, 'utf-8');

describe('the composer comes from bsv-kit/composer', () => {
  it('pins bsv-kit at a full commit, as Lampas does', () => {
    expect(pkg.dependencies['bsv-kit']).toMatch(/^github:Jonathan-A-White\/bsv-kit#[0-9a-f]{40}$/);
  });

  it('pins a commit that contains packages/composer', async () => {
    const composer = await import('bsv-kit/composer');
    expect(typeof composer.Composer).toBe('function');
    expect(typeof composer.HoldToTalkBar).toBe('function');
    expect(typeof composer.useHold).toBe('function');
    expect(typeof composer.startListening).toBe('function');
    expect(typeof composer.VoiceRecorder).toBe('function');
  });

  it('draws the composer and the Talk line from the package', () => {
    for (const file of ['src/cockpit/Composer.tsx', 'src/cockpit/TalkLineScreen.tsx', 'src/cockpit/useTalkLine.ts']) {
      expect(source(file), file).toMatch(/from 'bsv-kit\/composer'/);
    }
  });

  it('keeps no copy of what the package holds', () => {
    for (const file of [
      'src/cockpit/HoldToTalkBar.tsx',
      'src/cockpit/useHold.ts',
      'src/services/listen.ts',
      'src/services/micInput.ts',
      'src/services/recorder.ts',
    ]) {
      expect(existsSync(file), `${file} should be gone`).toBe(false);
    }
  });

  it('passes the app name, so the microphone help names Postern', () => {
    expect(source('src/cockpit/holdBar.ts')).toContain("APP_NAME = 'Postern'");
    expect(source('src/cockpit/Composer.tsx')).toContain('appName: APP_NAME');
    expect(source('src/cockpit/useTalkLine.ts')).toContain('appName: APP_NAME');
  });
});
