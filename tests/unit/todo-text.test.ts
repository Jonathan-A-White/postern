// tests/unit/todo-text.test.ts — mw-ev7oyy.22: a to-do's 'Text:' line as a Text button that opens his texting app
// (an sms: link, which Android hands to the default SMS app: Google Voice when he has made it the default).
import { describe, expect, it } from 'vitest';
import { linkKind, linkOpens, parseTextAction, textHref, textLabel } from '../../src/todo';

/** The draft back out of an href, as the SMS app reads it: what follows ?body=, percent-decoded. */
const bodyOf = (href: string) => decodeURIComponent(href.slice(href.indexOf('?body=') + '?body='.length));

describe("the Text: line parser", () => {
  it('reads who to text, their number and the draft from a Text: line', () => {
    expect(parseTextAction('Ask about Saturday.\n\nText: Dad +1 516-555-0123 | Hi Dad, would Saturday on Long Island suit you better?')).toEqual({
      name: 'Dad',
      number: '+15165550123',
      draft: 'Hi Dad, would Saturday on Long Island suit you better?',
    });
  });

  it('takes a number written in any common way, keeping only its digits and a leading +', () => {
    expect(parseTextAction('Text: (516) 555-0123 | Hi')).toEqual({ number: '5165550123', draft: 'Hi' });
    expect(parseTextAction('Text: Dad (+1 516.555.0123) | Hi')).toEqual({ name: 'Dad', number: '+15165550123', draft: 'Hi' });
  });

  it('with only a name before the bar, or nothing, there is no number: he picks the person', () => {
    expect(parseTextAction('Text: Dad | Hi Dad')).toEqual({ name: 'Dad', draft: 'Hi Dad' });
    expect(parseTextAction('Text: | Hi Dad')).toEqual({ draft: 'Hi Dad' });
  });

  it('with no bar, the whole line is the draft', () => {
    expect(parseTextAction('Text: Running late, there by 7.')).toEqual({ draft: 'Running late, there by 7.' });
  });

  it('runs the draft to the end of its paragraph, one line per line, and splits only at the first bar', () => {
    const notes = 'Text: Dad +15165550123 | Hi Dad,\nwould Saturday suit you | or Sunday?\n  Love, J\n\nCloses only on his word.';
    expect(parseTextAction(notes)?.draft).toBe('Hi Dad,\nwould Saturday suit you | or Sunday?\nLove, J');
  });

  it('ends the draft at an Open: line or a second Text: line, even with no blank line between', () => {
    expect(parseTextAction('Text: | Hi\nOpen: [Map](geo:1,2)')?.draft).toBe('Hi');
    expect(parseTextAction('Text: | First\nText: | Second')?.draft).toBe('First');
  });

  it('reads a Text: line set as a list item or in bold, as an Open: line may be', () => {
    expect(parseTextAction('- **Text:** Dad +15165550123 | Hi')).toEqual({ name: 'Dad', number: '+15165550123', draft: 'Hi' });
  });

  it('finds none in notes with no Text: line, or a Text: line with neither a number nor a draft', () => {
    expect(parseTextAction('Text Dad about Saturday. Open: [Map](geo:1,2)')).toBeUndefined();
    expect(parseTextAction('')).toBeUndefined();
    expect(parseTextAction('Text: |')).toBeUndefined();
    expect(parseTextAction('Not text: Dad | Hi')).toBeUndefined();
  });

  it('keeps a number with no draft: the button opens a text to them, empty', () => {
    expect(parseTextAction('Text: Dad +15165550123 |')).toEqual({ name: 'Dad', number: '+15165550123', draft: '' });
  });
});

describe('the Text button: its href and its words', () => {
  it('is sms:<number>?body=<encoded draft> with a number, sms:?body=<encoded draft> without', () => {
    expect(textHref({ number: '+15165550123', draft: 'Hi Dad' })).toBe('sms:+15165550123?body=Hi%20Dad');
    expect(textHref({ draft: 'Hi Dad' })).toBe('sms:?body=Hi%20Dad');
  });

  it('encodes &, ?, #, a newline, a plus, a percent and an emoji, so the draft arrives whole', () => {
    const draft = 'Fish & chips? Table #4.\nSee you at 7 + 1 = 8, 100% 👍';
    const href = textHref({ number: '+15165550123', draft });
    expect(href.startsWith('sms:+15165550123?body=')).toBe(true);
    expect(href).not.toMatch(/[&#\n ]|\?.*\?/);
    expect(href).toContain('%26');
    expect(href).toContain('%3F');
    expect(href).toContain('%23');
    expect(href).toContain('%0A');
    expect(href).toContain('%2B');
    expect(href).toContain('%25');
    expect(href).toContain('%F0%9F%91%8D');
    expect(bodyOf(href)).toBe(draft);
  });

  it('never throws on a broken character in the draft: it goes as a replacement mark', () => {
    expect(bodyOf(textHref({ draft: `a${'\uD83D'}b` }))).toBe('a�b');
  });

  it('with a number and no draft, opens a text to them with nothing filled in', () => {
    expect(textHref({ number: '+15165550123', draft: '' })).toBe('sms:+15165550123');
  });

  it('says on the button who a tap will text', () => {
    expect(textLabel({ name: 'Dad', number: '+15165550123', draft: 'Hi' })).toBe('Text Dad');
    expect(textLabel({ number: '+15165550123', draft: 'Hi' })).toBe('Text +15165550123');
    expect(textLabel({ draft: 'Hi' })).toBe('Text');
  });

  it('opens in the same tab, which is how Android hands it to the texting app', () => {
    expect(linkKind('sms:+15165550123?body=Hi')).toBe('text');
    expect(linkOpens('sms:+15165550123?body=Hi')).toBe('same-tab');
  });
});

