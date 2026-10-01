// tests/unit/prompt-call.test.ts — mw-nqur1n.5: the pure check of '/<name> [--flag value]...'
// against the saved prompts' signatures, and the list the composer offers as he types.
import { describe, expect, it } from 'vitest';
import { beginsCall, checkPromptCall, matchPrompts, tokenizeCall } from '../../src/model/prompts';
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
  it('says nothing for an unclosed quote', () => {
    expect(tokenizeCall('/sweep --who "Ann')).toBeUndefined();
  });
});

describe('matchPrompts', () => {
  it('lists the prompts whose names start with what is typed after the slash', () => {
    expect(matchPrompts('/', PROMPTS).map((p) => p.name)).toEqual(['sweep', 'top5', 'top-ten']);
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

  it('refuses an unclosed quote', () => {
    expect(checkPromptCall('/sweep --who "Ann', PROMPTS)).toEqual({ ok: false, error: 'A quote is not closed' });
  });
});
