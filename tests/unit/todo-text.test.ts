// tests/unit/todo-text.test.ts — mw-ev7oyy.22: a to-do's 'Text:' line as a Text button that opens his texting app
// (an sms: link, which Android hands to the default SMS app: Google Voice when he has made it the default).
// mw-ev7oyy.23: Voice was not his default, so on Android the button is an intent: link naming Google Voice.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linkKind, linkOpens, parseTextAction, textHref, textLabel } from '../../src/todo';

/** The draft back out of an href, as the SMS app reads it: what follows ?body=, percent-decoded. */
const bodyOf = (href: string) => decodeURIComponent(href.slice(href.indexOf('?body=') + '?body='.length));

/** Chrome on Android (its reduced user agent), an iPhone and a computer. */
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const COMPUTER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** An intent: link read as Android's Intent.parseUri reads it: the data before '#Intent;' with 'intent:' swapped for
 * the scheme, and each 'key=value' after it, the value percent-decoded. */
function parseIntent(href: string): { data: string; fields: Record<string, string> } {
  const at = href.lastIndexOf('#Intent;');
  const fields: Record<string, string> = {};
  for (const part of href.slice(at + '#Intent;'.length).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return { data: `${fields.scheme}:${href.slice('intent:'.length, at)}`, fields };
}

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
    expect(textHref({ number: '+15165550123', draft: 'Hi Dad' }, COMPUTER)).toBe('sms:+15165550123?body=Hi%20Dad');
    expect(textHref({ draft: 'Hi Dad' }, COMPUTER)).toBe('sms:?body=Hi%20Dad');
  });

  it('encodes &, ?, #, a newline, a plus, a percent and an emoji, so the draft arrives whole', () => {
    const draft = 'Fish & chips? Table #4.\nSee you at 7 + 1 = 8, 100% 👍';
    const href = textHref({ number: '+15165550123', draft }, COMPUTER);
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
    expect(bodyOf(textHref({ draft: `a${'\uD83D'}b` }, COMPUTER))).toBe('a�b');
  });

  it('with a number and no draft, opens a text to them with nothing filled in', () => {
    expect(textHref({ number: '+15165550123', draft: '' }, COMPUTER)).toBe('sms:+15165550123');
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

describe('the Text button on Android: Google Voice, by name (mw-ev7oyy.23)', () => {
  const draft = 'Fish & chips? Table #4.\nSee you at 7 + 1 = 8, 100% 👍';

  it('is an intent: link naming Google Voice, which Chrome turns into the sms: link it would open, handed to Voice alone', () => {
    const href = textHref({ name: 'Dad', number: '+15165550123', draft }, ANDROID);
    expect(href.startsWith('intent:+15165550123?body=')).toBe(true);
    expect(href.endsWith(';end')).toBe(true);
    const { data, fields } = parseIntent(href);
    expect(fields.package).toBe('com.google.android.apps.googlevoice');
    expect(fields.scheme).toBe('sms');
    expect(data).toBe(textHref({ number: '+15165550123', draft }, COMPUTER));
  });

  it('carries the whole draft percent-encoded, in the link and as the sms_body extra, so no & ? # newline + or emoji is lost', () => {
    const href = textHref({ number: '+15165550123', draft }, ANDROID);
    const before = href.slice(0, href.lastIndexOf('#Intent;'));
    expect(before).not.toMatch(/[&#;\n ]|\?.*\?/);
    for (const code of ['%26', '%3F', '%23', '%0A', '%2B', '%25', '%F0%9F%91%8D']) expect(before).toContain(code);
    expect(bodyOf(before)).toBe(draft);
    expect(parseIntent(href).fields['S.sms_body']).toBe(draft);
    expect(href.match(/#/g)).toHaveLength(1);
  });

  it("falls back to today's sms: link, for a browser that takes a fallback when Voice is not there", () => {
    const action = { number: '+15165550123', draft };
    expect(parseIntent(textHref(action, ANDROID)).fields['S.browser_fallback_url']).toBe(textHref(action, COMPUTER));
  });

  it('without a number, opens Voice itself (mw-ev7oyy.28: an sms: link with no recipient ended at the Play Store); without a draft, opens a text to them, empty', () => {
    const named = parseIntent(textHref({ name: 'Dad', draft: 'Hi Dad' }, ANDROID));
    expect(named.fields.action).toBe('android.intent.action.MAIN');
    expect(named.fields.package).toBe('com.google.android.apps.googlevoice');
    const empty = parseIntent(textHref({ number: '+15165550123', draft: '' }, ANDROID));
    expect(empty.data).toBe('sms:+15165550123');
    expect(empty.fields).not.toHaveProperty('S.sms_body');
    expect(empty.fields.package).toBe('com.google.android.apps.googlevoice');
  });

  it("on an iPhone or a computer is today's sms: link, unchanged", () => {
    expect(textHref({ number: '+15165550123', draft: 'Hi Dad' }, IPHONE)).toBe('sms:+15165550123?body=Hi%20Dad');
    expect(textHref({ number: '+15165550123', draft: 'Hi Dad' }, COMPUTER)).toBe('sms:+15165550123?body=Hi%20Dad');
    expect(textHref({ draft: 'Hi Dad' }, '')).toBe('sms:?body=Hi%20Dad');
  });
});

describe("the Mayor's filing note in docs/protocol.md", () => {
  it('has an example that reads as it says: a Text Dad button to his number, with the whole message', () => {
    const doc = readFileSync('docs/protocol.md', 'utf8');
    const block = /One example, as filed:\n\n {2}```text\n([\s\S]*?)\n {2}```/.exec(doc)?.[1];
    expect(block).toBeDefined();
    const action = parseTextAction((block ?? '').replace(/^ {2}/gm, ''));
    expect(action).toEqual({ name: 'Dad', number: '+15165550123', draft: expect.stringMatching(/^Hi Dad, would you rather meet us on Long Island on Saturday .* rest\.$/) });
    expect(textLabel(action!)).toBe('Text Dad');
    expect(textHref(action!, COMPUTER)).toMatch(/^sms:\+15165550123\?body=Hi%20Dad%2C%20would/);
  });
});
