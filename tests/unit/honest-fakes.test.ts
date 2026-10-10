// tests/unit/honest-fakes.test.ts — mw-it6qk5.4: the tests' speech synthesiser and microphone are bsv-kit/testing's
// honest ones (they fire every event the real ones fire, after the time the real ones take), not hand-made fakes
// that record speak() and never end it. A hand-made fake let the 'channel mic' bug (mw-f7gmps.2) reach his phone.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('the tests use bsv-kit/testing for speech and the microphone', () => {
  it('pins a bsv-kit that contains bsv-kit/testing/speech and bsv-kit/testing/mic', async () => {
    const speech = await import('bsv-kit/testing/speech');
    const mic = await import('bsv-kit/testing/mic');
    expect(typeof speech.installSpeech).toBe('function');
    expect(typeof speech.speechInitScript).toBe('function');
    expect(typeof mic.installMic).toBe('function');
    expect(typeof mic.micInitScript).toBe('function');
  });

  it('keeps no hand-made speech utterance in src, tests or features', () => {
    const own = /class\s+\w*Utterance\b|\bFakeUtterance\s*=/;
    const found = ['src', 'tests', 'features']
      .flatMap(filesUnder)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith('honest-fakes.test.ts'))
      .filter((file) => own.test(readFileSync(file, 'utf-8')));
    expect(found).toEqual([]);
  });
});
