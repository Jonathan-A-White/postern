// tests/unit/prompt-call.test.ts — mw-nqur1n.5: the pure check of '/<name> [--flag value]...'
// against the saved prompts' signatures, and the list the composer offers as he types.
import { describe, expect, it } from 'vitest';
import { beginsCall, checkPromptCall, halfTypedOption, matchPrompts, suggestNext, tokenizeCall } from '../../src/model/prompts';
import type { Prompt } from '../../src/data/db';

const base = { body: 'b', updatedAt: '2026-10-01T12:00:00Z', updatedBy: '02' };
const PROMPTS: Prompt[] = [
  { ...base, name: 'sweep', summary: 'Sweep a place', signature: [{ flag: '--who', type: 'string', required: true }] },
  {
    ...base,
    name: 'top5',
    summary: 'The five things that matter',
    signature: [
      { flag: '--duration', type: 'duration', default: '30m' },
      { flag: '--count', type: 'int' },
      { flag: '--loud', type: 'bool' },
      { flag: '--who', type: 'string' },
    ],
  },
  { ...base, name: 'top-ten', summary: 'Ten', signature: [] },
  { ...base, name: 'later', summary: 'Park a want', signature: [{ flag: '--text', type: 'text', required: true }] },
  { ...base, name: 'note', summary: 'A note', signature: [{ flag: '--loud', type: 'bool' }, { flag: '--text', type: 'text', default: 'nothing' }] },
];

describe('beginsCall', () => {
  it('is true when the text begins with a slash, ignoring nothing else', () => {
    expect(beginsCall('/top5')).toBe(true);
    expect(beginsCall('/')).toBe(true);
    expect(beginsCall('top5 /x')).toBe(false);
    expect(beginsCall(' /top5')).toBe(false);
    expect(beginsCall('')).toBe(false);
  });
});

describe('tokenizeCall', () => {
  it('splits on whitespace and keeps quoted words together', () => {
    expect(tokenizeCall('/sweep --who "Ann Lee"\n--x  1')).toEqual(['/sweep', '--who', 'Ann Lee', '--x', '1']);
    expect(tokenizeCall("/sweep --who 'Ann Lee'")).toEqual(['/sweep', '--who', 'Ann Lee']);
  });
  it('says nothing for an unclosed double quote', () => {
    expect(tokenizeCall('/sweep --who "Ann')).toBeUndefined();
  });
  it('reads an apostrophe inside or at the end of a word as a letter, not a quote', () => {
    expect(tokenizeCall("/later I'm sure it's Luke's")).toEqual(['/later', "I'm", 'sure', "it's", "Luke's"]);
    expect(tokenizeCall("/later the dogs' bowls")).toEqual(['/later', 'the', "dogs'", 'bowls']);
  });
  it("reads a single quote opening a word as a quote only when it closes at the end of a word", () => {
    expect(tokenizeCall("/later --text 'a b' --x 1")).toEqual(['/later', '--text', 'a b', '--x', '1']);
    expect(tokenizeCall("/later 'tis the season")).toEqual(['/later', "'tis", 'the', 'season']);
    expect(tokenizeCall("/later 'a b")).toEqual(['/later', "'a", 'b']);
  });
  it('lets a double-quoted word hold an apostrophe', () => {
    expect(tokenizeCall('/later --text "it\'s Luke\'s"')).toEqual(['/later', '--text', "it's Luke's"]);
  });
});

describe('matchPrompts', () => {
  it('lists the prompts whose names start with what is typed after the slash', () => {
    expect(matchPrompts('/', PROMPTS).map((p) => p.name)).toEqual(['sweep', 'top5', 'top-ten', 'later', 'note']);
    expect(matchPrompts('/top', PROMPTS).map((p) => p.name)).toEqual(['top5', 'top-ten']);
    expect(matchPrompts('/top5', PROMPTS).map((p) => p.name)).toEqual(['top5']);
  });
  it('lists nothing once a space is typed, for no match, or for text not beginning with a slash', () => {
    expect(matchPrompts('/top5 ', PROMPTS)).toEqual([]);
    expect(matchPrompts('/top5 --loud', PROMPTS)).toEqual([]);
    expect(matchPrompts('/zzz', PROMPTS)).toEqual([]);
    expect(matchPrompts('hello', PROMPTS)).toEqual([]);
  });
});

describe('checkPromptCall', () => {
  it('passes a call with no options when none are required', () => {
    expect(checkPromptCall('/top5', PROMPTS)).toEqual({ ok: true, name: 'top5', options: {} });
    expect(checkPromptCall('/top5 ', PROMPTS)).toEqual({ ok: true, name: 'top5', options: {} });
  });

  it('passes options of every type and reports what was given, filling nothing in', () => {
    expect(checkPromptCall('/top5 --duration 15m --count 3 --loud --who "Ann Lee"', PROMPTS)).toEqual({
      ok: true,
      name: 'top5',
      options: { '--duration': '15m', '--count': '3', '--loud': 'true', '--who': 'Ann Lee' },
    });
  });

  it('names an unknown prompt', () => {
    expect(checkPromptCall('/top6', PROMPTS)).toEqual({ ok: false, error: 'Unknown prompt /top6' });
    expect(checkPromptCall('/', PROMPTS)).toEqual({ ok: false, error: 'Choose a prompt from the list' });
  });

  it('names an option the prompt does not have', () => {
    expect(checkPromptCall('/top5 --speed 3', PROMPTS)).toEqual({ ok: false, error: '/top5 has no option --speed' });
    expect(checkPromptCall('/top5 loose', PROMPTS)).toEqual({ ok: false, error: 'Expected an option like --duration, not "loose"' });
  });

  it('wants a Go duration for a duration', () => {
    for (const good of ['30m', '1h', '1h30m', '45s', '1.5h', '250ms', '0']) expect(checkPromptCall(`/top5 --duration ${good}`, PROMPTS).ok).toBe(true);
    for (const bad of ['soon', '30', '5 minutes', 'm', '-', '1d']) {
      const verdict = checkPromptCall(`/top5 --duration ${bad.replace(' ', '_')}`, PROMPTS);
      expect(verdict).toEqual({ ok: false, error: '--duration wants a duration like 30m' });
    }
  });

  it('wants a whole number for an int', () => {
    expect(checkPromptCall('/top5 --count -2', PROMPTS).ok).toBe(true);
    expect(checkPromptCall('/top5 --count 2.5', PROMPTS)).toEqual({ ok: false, error: '--count wants a whole number' });
    expect(checkPromptCall('/top5 --count many', PROMPTS)).toEqual({ ok: false, error: '--count wants a whole number' });
  });

  it('takes a bool on its own, or as true or false', () => {
    expect(checkPromptCall('/top5 --loud --count 1', PROMPTS)).toMatchObject({ ok: true, options: { '--loud': 'true', '--count': '1' } });
    expect(checkPromptCall('/top5 --loud false', PROMPTS)).toMatchObject({ ok: true, options: { '--loud': 'false' } });
    expect(checkPromptCall('/top5 --loud maybe', PROMPTS)).toEqual({ ok: false, error: 'Expected an option like --duration, not "maybe"' });
  });

  it('wants a value after an option that takes one', () => {
    expect(checkPromptCall('/top5 --duration', PROMPTS)).toEqual({ ok: false, error: '--duration wants a duration like 30m' });
    expect(checkPromptCall('/top5 --who --loud', PROMPTS)).toEqual({ ok: false, error: '--who wants a value' });
  });

  it('refuses an option given twice and a required option left out', () => {
    expect(checkPromptCall('/top5 --count 1 --count 2', PROMPTS)).toEqual({ ok: false, error: '--count is given twice' });
    expect(checkPromptCall('/sweep', PROMPTS)).toEqual({ ok: false, error: '/sweep needs --who' });
    expect(checkPromptCall('/sweep --who Ann', PROMPTS).ok).toBe(true);
  });

  it("takes apostrophes in a /later text as letters, and a quoted value either way", () => {
    expect(checkPromptCall("/later I'm sure it's Luke's", PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': "I'm sure it's Luke's" } });
    expect(checkPromptCall("/later --text 'a b'", PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': 'a b' } });
    expect(checkPromptCall('/later --text "a b"', PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': 'a b' } });
  });

  it('refuses an unclosed quote', () => {
    expect(checkPromptCall('/sweep --who "Ann', PROMPTS)).toEqual({ ok: false, error: 'A quote is not closed' });
  });
});

describe('suggestNext (mw-nqur1n.16)', () => {
  it('completes a half-typed option name to the first option not yet given', () => {
    for (const typed of ['/top5 -', '/top5 --', '/top5 --du']) {
      const suggestion = suggestNext(typed, PROMPTS);
      expect(suggestion?.kind).toBe('option');
      expect(suggestion?.text).toBe('--duration');
      expect(typed + suggestion?.rest).toBe('/top5 --duration ');
    }
  });

  it('skips an option already given', () => {
    expect(suggestNext('/top5 --duration 15m --', PROMPTS)?.text).toBe('--count');
    expect(suggestNext('/top5 --duration 15m --d', PROMPTS)).toBeUndefined();
  });

  it('suggests the default after a complete option name and a space', () => {
    const suggestion = suggestNext('/top5 --duration ', PROMPTS);
    expect(suggestion).toMatchObject({ kind: 'value', text: '30m', rest: '30m' });
  });

  it('completes a half-typed default', () => {
    expect(suggestNext('/top5 --duration 3', PROMPTS)).toMatchObject({ kind: 'value', rest: '0m' });
    expect(suggestNext('/top5 --duration 30m', PROMPTS)).toBeUndefined();
  });

  it('suggests nothing once the value is given', () => {
    expect(suggestNext('/top5 --duration 15m ', PROMPTS)).toBeUndefined();
  });

  it('suggests no value for an option with no default, required or not', () => {
    expect(suggestNext('/sweep --who ', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top5 --count ', PROMPTS)).toBeUndefined();
  });

  it('suggests nothing for an unknown prompt, a bare name, an unknown option or plain text', () => {
    expect(suggestNext('/nope --', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top5', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top5 ', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top5 --zzz', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top5 --zzz ', PROMPTS)).toBeUndefined();
    expect(suggestNext('hello --', PROMPTS)).toBeUndefined();
    expect(suggestNext('/top-ten --', PROMPTS)).toBeUndefined();
  });

  it('suggests nothing for a bool option beyond its name', () => {
    expect(suggestNext('/top5 --loud ', PROMPTS)).toBeUndefined();
  });
});

describe('halfTypedOption (mw-nqur1n.16)', () => {
  it('is true while the last word is the start of an option', () => {
    expect(halfTypedOption('/top5 -', PROMPTS)).toBe(true);
    expect(halfTypedOption('/top5 --', PROMPTS)).toBe(true);
    expect(halfTypedOption('/top5 --du', PROMPTS)).toBe(true);
    expect(halfTypedOption('/sweep --', PROMPTS)).toBe(true);
    expect(halfTypedOption('/top5 --duration', PROMPTS)).toBe(true);
  });
  it('is false for a complete unknown option, a finished call, or an earlier fault', () => {
    expect(halfTypedOption('/top5 --nope', PROMPTS)).toBe(false);
    expect(halfTypedOption('/top5 --nope ', PROMPTS)).toBe(false);
    expect(halfTypedOption('/top5 --du ', PROMPTS)).toBe(false);
    expect(halfTypedOption('/top5 --duration soon --', PROMPTS)).toBe(false);
    expect(halfTypedOption('/top5 --duration 15m', PROMPTS)).toBe(false);
    expect(halfTypedOption('/top5', PROMPTS)).toBe(false);
  });
});

describe('checkPromptCall with a text option', () => {
  it('takes the words no flag consumes as the text, joined by single spaces', () => {
    expect(checkPromptCall('/later a licence for Luke', PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': 'a licence for Luke' } });
    expect(checkPromptCall('/later   a   licence \n for  Luke', PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': 'a licence for Luke' } });
  });
  it('leaves a bool flag its own words and still reads the words after it as the text', () => {
    expect(checkPromptCall('/note --loud true buy milk', PROMPTS)).toEqual({ ok: true, name: 'note', options: { '--loud': 'true', '--text': 'buy milk' } });
    expect(checkPromptCall('/note buy milk --loud', PROMPTS)).toEqual({ ok: true, name: 'note', options: { '--loud': 'true', '--text': 'buy milk' } });
  });
  it('still wants a required text, and accepts one left out when it has a default', () => {
    expect(checkPromptCall('/later', PROMPTS)).toEqual({ ok: false, error: '/later needs some words' });
    expect(checkPromptCall('/note', PROMPTS)).toEqual({ ok: true, name: 'note', options: {} });
  });
  it('takes the text by its flag too, refuses it given both ways, and still refuses an unknown flag', () => {
    expect(checkPromptCall('/later --text one', PROMPTS)).toEqual({ ok: true, name: 'later', options: { '--text': 'one' } });
    expect(checkPromptCall('/later --text one two', PROMPTS)).toEqual({ ok: false, error: '--text is given twice' });
    expect(checkPromptCall('/later one --text two', PROMPTS)).toEqual({ ok: false, error: '--text is given twice' });
    expect(checkPromptCall('/later some words --nope', PROMPTS)).toEqual({ ok: false, error: '/later has no option --nope' });
  });
  it('refuses stray words as today when the prompt has no text option', () => {
    expect(checkPromptCall('/top5 a licence', PROMPTS)).toEqual({ ok: false, error: 'Expected an option like --duration, not "a"' });
  });
});
