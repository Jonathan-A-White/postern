// tests/unit/speech-from-kit.test.ts — mw-m7v5kc.2: the read-aloud engine, the hook and the bar come from bsv-kit's
// packages/speech, as the composer came from packages/composer (mw-jtzpw0.2). Postern keeps only what is its own: the Talk
// line's key, bead ids said as titles, and the bar's colours. The package makes the utterances.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as kit from 'bsv-kit/speech';
import * as kitReact from 'bsv-kit/speech/react';
import * as engine from '../../src/services/speech';
import * as hook from '../../src/cockpit/useSpeaking';
import { SpeakingBar } from '../../src/cockpit/SpeakingBar';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('read-aloud comes from bsv-kit/speech', () => {
  it('makes no utterance in src: the package does', () => {
    const made = filesUnder('src')
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => /new\s+SpeechSynthesisUtterance/.test(readFileSync(file, 'utf-8')));
    expect(made).toEqual([]);
  });

  it('steers the very speech the package holds: one engine, not a copy', () => {
    expect(engine.pause).toBe(kit.pause);
    expect(engine.resume).toBe(kit.resume);
    expect(engine.restart).toBe(kit.restart);
    expect(engine.stop).toBe(kit.stop);
    expect(engine.getSpeech).toBe(kit.getSpeech);
    expect(engine.subscribe).toBe(kit.subscribe);
    expect(engine.isSpeaking).toBe(kit.isSpeaking);
    expect(engine.isPausedOn).toBe(kit.isPausedOn);
    expect(engine.whenDone).toBe(kit.whenDone);
    expect(engine.isSupported).toBe(kit.isSupported);
  });

  it('takes the hook and the bar from the package, with the Talk line key still Postern\'s', () => {
    expect(hook.useSpeaking).toBe(kitReact.useSpeaking);
    expect(hook.useSpeech).toBe(kitReact.useSpeech);
    expect(typeof SpeakingBar).toBe('function');
    expect(engine.TALK_ANSWER_KEY).toBe('talk-answer');
  });
});
