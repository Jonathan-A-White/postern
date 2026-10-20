// tests/unit/composer-package.test.ts — mw-jtzpw0.2: the hold-to-talk composer comes from voice-kit's
// packages/composer, pinned at a commit, not from a copy in this repo. Postern keeps what is its own
// (drafts, saved prompts, quotes, shared-in files, the Talk line) and passes its theme in.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { dependencies: Record<string, string> };
const source = (path: string) => readFileSync(path, 'utf-8');

describe('the composer comes from voice-kit/composer', () => {
  it('pins voice-kit at a full commit, as Lampas does', () => {
    expect(pkg.dependencies['voice-kit']).toMatch(/^github:Jonathan-A-White\/voice-kit#[0-9a-f]{40}$/);
  });

  it('pins a commit that contains packages/composer', async () => {
    const composer = await import('voice-kit/composer');
    expect(typeof composer.Composer).toBe('function');
    expect(typeof composer.HoldToTalkBar).toBe('function');
    expect(typeof composer.useHold).toBe('function');
    expect(typeof composer.startListening).toBe('function');
    expect(typeof composer.VoiceRecorder).toBe('function');
  });

  it('draws the composer and the Talk line from the package', () => {
    for (const file of ['src/cockpit/Composer.tsx', 'src/cockpit/TalkLineScreen.tsx', 'src/cockpit/useTalkLine.ts']) {
      expect(source(file), file).toMatch(/from 'voice-kit\/composer'/);
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
    expect(source('src/cockpit/Composer.tsx')).toContain('appName={APP_NAME}');
    expect(source('src/cockpit/useTalkLine.ts')).toContain('appName: APP_NAME');
  });
});

// mw-06ggew.5: the compose bar is the kit's Composer, driven by one settings object; the Talk line's bar reads the same.
describe("the compose bar is the kit's Composer with Postern's settings", () => {
  it('POSTERN_COMPOSER_SETTINGS: hold to talk, send on release, type, attach, camera and a voice note', async () => {
    const { POSTERN_COMPOSER_SETTINGS } = await import('../../src/cockpit/holdBar');
    expect(POSTERN_COMPOSER_SETTINGS).toEqual({ talk: 'hold', send: 'release', type: true, attach: true, camera: true, voiceNote: true });
  });

  it("renders the kit's Composer with those settings and has no press, attach, camera or Send logic of its own", () => {
    const composer = source('src/cockpit/Composer.tsx');
    expect(composer).toMatch(/import \{[^}]*\bComposer as KitComposer\b[^}]*\} from 'voice-kit\/composer'/);
    expect(composer).toContain('settings={POSTERN_COMPOSER_SETTINGS}');
    for (const own of ['useHold', 'HoldToTalkBar', 'type="file"', 'capture=', 'onPaste', 'onDrop', 'aria-label="Send"']) {
      expect(composer, own).not.toContain(own);
    }
    expect(composer.split('\n').length).toBeLessThan(200);
  });

  it("the Talk line's hold bar takes the same settings", () => {
    expect(source('src/cockpit/TalkLineScreen.tsx')).toMatch(/<HoldToTalkBar[^>]*settings=\{POSTERN_COMPOSER_SETTINGS\}/);
  });
});
