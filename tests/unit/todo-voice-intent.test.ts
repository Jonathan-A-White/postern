// tests/unit/todo-voice-intent.test.ts — mw-ev7oyy.28: a Text on Android never ends at the Play Store, and the draft rides as the sms_body extra.
// 'Text Matthew Steele' (a name, no number) made intent:?body=…;package=<Voice>: no Voice activity resolves an sms: link with no
// recipient, so Chrome sent the named package to its Play Store page. A line with no number now opens Voice itself (its launcher)
// and copies the draft; the unit tests prove the links and the copy, only his tap proves Voice opens.
import { describe, expect, it } from 'vitest';
import { LINK_KINDS, linkProps, parseEmailAction, parseListenAction, parseOpenLinks, parseTextAction, textCopyDraft, textHref, linkCopyDraft, emailHref, listenHref } from '../../src/todo';

const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const COMPUTER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const VOICE = 'com.google.android.apps.googlevoice';

function fieldsOf(href: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of href.slice(href.lastIndexOf('#Intent;') + '#Intent;'.length).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return fields;
}

/** Whether a link is an intent naming a package that nothing in the package can resolve: no recipient and no launcher to open. */
function canEndAtPlayStore(href: string): boolean {
  if (!href.startsWith('intent:')) return false;
  const fields = fieldsOf(href);
  if (!fields.package) return false;
  if (fields.action === 'android.intent.action.MAIN' && fields.category === 'android.intent.category.LAUNCHER') return false;
  const data = href.slice('intent:'.length, href.lastIndexOf('#Intent;'));
  const recipient = data.split('?')[0].replace(/^\/\//, '');
  return recipient === '';
}

describe('a Text link on Android carries the draft as the sms_body extra (mw-ev7oyy.28 AC-1)', () => {
  it('gives an open-line sms: chip with a number an intent: with S.sms_body and Google Voice', () => {
    const [chip] = parseOpenLinks('Open: [Text Dad](sms:5551234567?body=hello%20there)');
    const href = linkProps(chip, ANDROID).href;
    expect(href.startsWith('intent:5551234567?body=hello%20there#Intent;')).toBe(true);
    expect(href).toContain('S.sms_body=hello%20there;');
    expect(href).toContain(`package=${VOICE};`);
  });

  it('gives the Text button the same for "Text: Dad 5551234567 | hello there"', () => {
    const action = parseTextAction('Text: Dad 5551234567 | hello there')!;
    const href = textHref(action, ANDROID);
    expect(href).toContain('S.sms_body=hello%20there;');
    expect(href).toContain(`package=${VOICE};`);
    expect(canEndAtPlayStore(href)).toBe(false);
  });

  it('keeps a hard draft whole in the extra and leaves the plain sms: link with ?body= on a computer', () => {
    const draft = 'Fish & chips? #4\n+1 100% 👍';
    const [chip] = parseOpenLinks(`Open: [Text Dad](sms:5551234567?body=${encodeURIComponent(draft)})`);
    expect(fieldsOf(linkProps(chip, ANDROID).href)['S.sms_body']).toBe(draft);
    expect(linkProps(chip, COMPUTER).href).toBe(`sms:5551234567?body=${encodeURIComponent(draft)}`);
    expect(textHref({ number: '5551234567', draft: 'hello there' }, COMPUTER)).toBe('sms:5551234567?body=hello%20there');
  });
});

describe('a Text with a name and no number never ends at the Play Store (mw-ev7oyy.28 AC-2)', () => {
  const action = parseTextAction('Text: Matthew Steele | Hi Matthew, are we still on for Friday?')!;

  it('opens Voice itself, through its launcher, not an sms: link with no recipient', () => {
    const href = textHref(action, ANDROID);
    expect(href.startsWith('intent:')).toBe(true);
    expect(canEndAtPlayStore(href)).toBe(false);
    const fields = fieldsOf(href);
    expect(fields.package).toBe(VOICE);
    expect(fields.action).toBe('android.intent.action.MAIN');
    expect(fields.category).toBe('android.intent.category.LAUNCHER');
    expect(fields).not.toHaveProperty('scheme');
    // Chrome takes only an http(s) fallback; with anything else a launcher it cannot resolve ends at the Play Store.
    expect(fields['S.browser_fallback_url']).toBe('https://voice.google.com/messages');
  });

  it('says the draft is to be copied before Voice opens, and which draft', () => {
    expect(textCopyDraft(action, ANDROID)).toBe('Hi Matthew, are we still on for Friday?');
    expect(textCopyDraft(action, COMPUTER)).toBeUndefined();
    expect(textCopyDraft({ name: 'Dad', number: '5551234567', draft: 'Hi' }, ANDROID)).toBeUndefined();
  });

  it('does the same for an open-line sms: chip with no number', () => {
    const [chip] = parseOpenLinks('Open: [Text Matthew](sms:?body=Hi%20Matthew%20%26%20co)');
    const href = linkProps(chip, ANDROID).href;
    expect(canEndAtPlayStore(href)).toBe(false);
    expect(fieldsOf(href).action).toBe('android.intent.action.MAIN');
    expect(linkCopyDraft(chip, ANDROID)).toBe('Hi Matthew & co');
    expect(linkProps(chip, COMPUTER).href).toBe('sms:?body=Hi%20Matthew%20%26%20co');
    expect(linkCopyDraft(chip, COMPUTER)).toBeUndefined();
  });

  it('copies nothing for a line with a number, or an sms: chip with no draft (Voice opens its launcher)', () => {
    const [withNumber] = parseOpenLinks('Open: [Text Dad](sms:5551234567?body=Hi)');
    expect(linkCopyDraft(withNumber, ANDROID)).toBeUndefined();
    const [bare] = parseOpenLinks('Open: [Text](sms:)');
    expect(canEndAtPlayStore(linkProps(bare, ANDROID).href)).toBe(false);
    expect(linkCopyDraft(bare, ANDROID)).toBeUndefined();
  });
});

describe('every action kind on Android, name-only or partial (mw-ev7oyy.28 sweep)', () => {
  const samples: Record<string, string[]> = {
    kindle: ['kindle://book?action=open&asin=B0C74TJ712'],
    audible: ['https://www.audible.com/pd/B0CC36V9KG'],
    call: ['tel:+15555550123', 'tel:'],
    text: ['sms:+15555550123?body=Hi', 'smsto:+15555550123', 'sms:?body=Hi', 'sms:', 'smsto:', 'SMS:?body=Hi%20there'],
    email: ['mailto:luke@example.com?subject=Hi', 'mailto:'],
    map: ['geo:37.78,-122.41', 'https://maps.app.goo.gl/AbCd123', 'https://www.google.com/maps/place/Home'],
    podcast: ['https://pca.st/episode/abc'],
    web: ['https://example.com/page'],
    app: ['logosres:biblia;ref=John3'],
  };

  it('has a sample for every row of the table', () => {
    expect(Object.keys(samples).sort()).toEqual(LINK_KINDS.map((row) => row.kind).sort());
  });

  it.each(Object.entries(samples).flatMap(([kind, urls]) => urls.map((url) => [kind, url] as const)))('%s %s cannot end at the Play Store', (_kind, url) => {
    expect(canEndAtPlayStore(linkProps({ text: 'x', url }, ANDROID).href)).toBe(false);
  });

  it('gives the Email, Listen and Text buttons no href that can', () => {
    for (const line of ['Email: Luke luke@example.com | Hello | Hi Luke', 'Email: luke@example.com']) {
      expect(canEndAtPlayStore(emailHref(parseEmailAction(line)!))).toBe(false);
    }
    expect(parseEmailAction('Email: Luke | Hello | Hi Luke')).toBeUndefined();
    expect(canEndAtPlayStore(listenHref(parseListenAction('Audible: B0CC36V9KG')!))).toBe(false);
    for (const line of ['Text: Matthew Steele | Hi', 'Text: Hi there', 'Text: +15555550123', 'Text: Dad 5551234567 | hi']) {
      expect(canEndAtPlayStore(textHref(parseTextAction(line)!, ANDROID))).toBe(false);
    }
  });
});
