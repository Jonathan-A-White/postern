// tests/unit/todo-email.test.ts — mw-ev7oyy.26: a to-do's 'Email:' line as an Email button that opens his mail app
// (a mailto: link, which Android hands to his default mail app: Gmail) addressed to the person, subject and draft filled in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emailHref, emailLabel, linkKind, linkOpens, listenHref, parseEmailAction, parseTextAction, textHref } from '../../src/todo';

/** A mailto: link read as a mail app reads it: the address, then each query field percent-decoded. */
function parseMailto(href: string): { to: string; fields: Record<string, string> } {
  expect(href.startsWith('mailto:')).toBe(true);
  const query = href.indexOf('?');
  const to = decodeURIComponent(href.slice('mailto:'.length, query < 0 ? undefined : query));
  const fields: Record<string, string> = {};
  if (query >= 0) {
    for (const part of href.slice(query + 1).split('&')) {
      const eq = part.indexOf('=');
      fields[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
    }
  }
  return { to, fields };
}

describe('the Email: line parser', () => {
  it('reads who to write to, their address, the subject and the draft', () => {
    expect(parseEmailAction('Ask Luke.\n\nEmail: Luke luke@example.com | Push notifications | Hi Luke, here is how Postern does it.')).toEqual({
      name: 'Luke',
      address: 'luke@example.com',
      subject: 'Push notifications',
      draft: 'Hi Luke, here is how Postern does it.',
    });
  });

  it('takes an address written in angle brackets or after a name with punctuation', () => {
    expect(parseEmailAction('Email: Luke Smith <luke.smith+postern@example.co.uk> | Hi | Body')).toEqual({
      name: 'Luke Smith',
      address: 'luke.smith+postern@example.co.uk',
      subject: 'Hi',
      draft: 'Body',
    });
    expect(parseEmailAction('Email: Luke (luke@example.com) | Hi | Body')).toMatchObject({ name: 'Luke', address: 'luke@example.com' });
  });

  it('with only an address before the bar, there is no name', () => {
    expect(parseEmailAction('Email: luke@example.com | Hi | Body')).toEqual({ address: 'luke@example.com', subject: 'Hi', draft: 'Body' });
  });

  it('runs the draft to the end of its paragraph, a line for a line, and splits only at the first two bars', () => {
    const long = 'Email: Luke luke@example.com | Subject | Hi Luke,\nthis | that\n  Love, J\n\nCloses on his word.';
    expect(parseEmailAction(long)?.draft).toBe('Hi Luke,\nthis | that\nLove, J');
  });

  it('ends the draft at an Open:, Text: or second Email: line, even with no blank line between', () => {
    expect(parseEmailAction('Email: a@b.co | S | Hi\nOpen: [Map](geo:1,2)')?.draft).toBe('Hi');
    expect(parseEmailAction('Email: a@b.co | S | Hi\nText: | Yo')?.draft).toBe('Hi');
    expect(parseEmailAction('Email: a@b.co | S | First\nEmail: c@d.co | S | Second')?.draft).toBe('First');
  });

  it('ends a Text: draft at an Email: line too', () => {
    expect(parseTextAction('Text: | Hi\nEmail: a@b.co | S | Yo')?.draft).toBe('Hi');
  });

  it('reads an Email: line set as a list item or in bold, as an Open: line may be', () => {
    expect(parseEmailAction('- **Email:** a@b.co | S | Hi')).toEqual({ address: 'a@b.co', subject: 'S', draft: 'Hi' });
  });

  it('with no subject bar, only an address (and perhaps a name) is read', () => {
    expect(parseEmailAction('Email: Luke luke@example.com')).toEqual({ name: 'Luke', address: 'luke@example.com', subject: '', draft: '' });
    expect(parseEmailAction('Email: Luke luke@example.com | A subject')).toEqual({ name: 'Luke', address: 'luke@example.com', subject: 'A subject', draft: '' });
  });

  it('finds none with no address: the line stays plain text', () => {
    expect(parseEmailAction('Email: Luke | Hi | Body')).toBeUndefined();
    expect(parseEmailAction('Email: | Hi | Body')).toBeUndefined();
    expect(parseEmailAction('Email: Luke luke@ | Hi | Body')).toBeUndefined();
    expect(parseEmailAction('Email: Luke not-an-address.com | Hi | Body')).toBeUndefined();
    expect(parseEmailAction('')).toBeUndefined();
    expect(parseEmailAction('Email Luke about it. luke@example.com')).toBeUndefined();
    expect(parseEmailAction('Not email: luke@example.com | Hi | Body')).toBeUndefined();
  });

  it('an address on a later line is not the address of the Email: line', () => {
    expect(parseEmailAction('Email: Luke | Hi | Body\nluke@example.com')).toBeUndefined();
  });
});

describe('the Email button: its href and its words', () => {
  it('is mailto:<address>?subject=<encoded>&body=<encoded>', () => {
    expect(emailHref({ address: 'luke@example.com', subject: 'Hi Luke', draft: 'Hello' })).toBe('mailto:luke@example.com?subject=Hi%20Luke&body=Hello');
  });

  it('leaves out the subject or the body when empty, and both when both are', () => {
    expect(emailHref({ address: 'luke@example.com', subject: '', draft: 'Hello' })).toBe('mailto:luke@example.com?body=Hello');
    expect(emailHref({ address: 'luke@example.com', subject: 'Hi', draft: '' })).toBe('mailto:luke@example.com?subject=Hi');
    expect(emailHref({ address: 'luke@example.com', subject: '', draft: '' })).toBe('mailto:luke@example.com');
  });

  it('encodes &, ?, #, a line break, a plus, a percent, a space, a link and an emoji, in the subject and the draft, so they arrive whole', () => {
    const subject = 'Fish & chips? Table #4 + 100%';
    const draft = 'Fish & chips? Table #4.\nSee https://example.com/a?b=c&d=e#f\r\nat 7 + 1 = 8, 100% 👍\n\nBye';
    const href = emailHref({ name: 'Luke', address: 'luke@example.com', subject, draft });
    expect(href).not.toMatch(/[ \n\r#]/);
    expect(href.match(/\?/g)).toHaveLength(1);
    expect(href.match(/&/g)).toHaveLength(1);
    for (const code of ['%26', '%3F', '%23', '%0D%0A', '%2B', '%25', '%20', '%F0%9F%91%8D', '%3A%2F%2F']) expect(href).toContain(code);
    const { to, fields } = parseMailto(href);
    expect(to).toBe('luke@example.com');
    expect(fields.subject).toBe(subject);
    // a mail app reads %0D%0A (RFC 6068) as one line break
    expect(fields.body.replace(/\r\n/g, '\n')).toBe(draft.replace(/\r\n/g, '\n'));
  });

  it('never throws on a broken character: it goes as a replacement mark', () => {
    expect(parseMailto(emailHref({ address: 'a@b.co', subject: `a${'\uD83D'}b`, draft: `c${'\uDE00'}d` })).fields).toEqual({ subject: 'a�b', body: 'c�d' });
  });

  it('keeps the address whole, a plus and a dot included', () => {
    expect(emailHref({ address: 'luke.smith+postern@example.co.uk', subject: '', draft: '' })).toBe('mailto:luke.smith+postern@example.co.uk');
  });

  it('says on the button who a tap will write to: the name, else the address', () => {
    expect(emailLabel({ name: 'Luke', address: 'luke@example.com', subject: '', draft: '' })).toBe('Email Luke');
    expect(emailLabel({ address: 'luke@example.com', subject: '', draft: '' })).toBe('Email luke@example.com');
  });

  it('opens in the same tab, which is how Android hands it to the mail app', () => {
    expect(linkKind('mailto:luke@example.com?subject=Hi')).toBe('email');
    expect(linkOpens('mailto:luke@example.com?subject=Hi')).toBe('same-tab');
  });
});

describe('the sweep (mw-ev7oyy.26): the links a card builds from notes are encoded alike', () => {
  const draft = 'Fish & chips? Table #4, 100% + more 👍';

  it('the Email and Text buttons percent-encode a draft to the same characters; Open: urls are kept as written; Listen is built by audible-kit', () => {
    const body = (href: string) => href.slice(href.indexOf('body=') + 'body='.length);
    expect(body(emailHref({ address: 'a@b.co', subject: '', draft }))).toBe(body(textHref({ draft }, 'Mozilla/5.0 (X11; Linux x86_64)')));
    expect(listenHref({ asin: 'B0CC36V9KG', positionMs: 5 }, 7)).toMatch(/^https:\/\/[^\s]+$/);
    expect(listenHref({ asin: 'B0CC36V9KG', positionMs: 5 }, 7)).not.toMatch(/[ #]/);
  });
});

describe("the Mayor's filing note in docs/protocol.md", () => {
  it('has an email example that reads as it says: an Email Luke button to his address, with the subject and the whole draft', () => {
    const doc = readFileSync('docs/protocol.md', 'utf8');
    const block = /One email example, as filed:\n\n {2}```text\n([\s\S]*?)\n {2}```/.exec(doc)?.[1];
    expect(block).toBeDefined();
    const action = parseEmailAction((block ?? '').replace(/^ {2}/gm, ''));
    expect(action).toEqual({ name: 'Luke', address: 'luke@example.com', subject: 'How Postern sends push notifications', draft: expect.stringMatching(/^Hi Luke,\nPostern sends them as Web Push: .*\nThanks, Jonathan$/) });
    expect(emailLabel(action!)).toBe('Email Luke');
  });
});
