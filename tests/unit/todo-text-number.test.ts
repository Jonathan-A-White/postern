// tests/unit/todo-text-number.test.ts — mw-ev7oyy.35: the home writes a found number into a Text: line as
// 'Text: Matthew Steele <+15551230001> | <draft>', or leaves the line and says why in a 'Contacts: ...' line right
// below it; the phone reads both, and writes the number he types into the line the same way.
import { describe, expect, it } from 'vitest';
import { parsePhoneNumber, parseTextAction, textHref, textLabel, textNumberLabel, withTextNumber } from '../../src/todo';

describe('a Text: line the home gave a number', () => {
  it("reads 'Name <+number> | draft' as the name, the number and the draft, with no stray brackets in the name", () => {
    const action = parseTextAction('Text: Matthew Steele <+15551230001> | Running ten late');
    expect(action).toEqual({ name: 'Matthew Steele', number: '+15551230001', draft: 'Running ten late' });
    expect(textLabel(action!)).toBe('Text Matthew Steele');
    expect(textHref(action!, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('sms:+15551230001?body=Running%20ten%20late');
  });

  it('reads the line when it is set as a list item or in bold', () => {
    expect(parseTextAction('- **Text:** Matthew Steele <+15551230001> | Hi')).toEqual({ name: 'Matthew Steele', number: '+15551230001', draft: 'Hi' });
  });
});

describe("the home's reason", () => {
  it("is the 'Contacts:' line right below a name-only Text: line, kept out of the draft", () => {
    const action = parseTextAction('Text: Matthew | Running ten late\nContacts: two contacts match Matthew\n\nOther notes.');
    expect(action).toEqual({ name: 'Matthew', draft: 'Running ten late', reason: 'two contacts match Matthew' });
  });

  it('is kept out of a draft that runs over several lines, which carries on below it', () => {
    expect(parseTextAction('Text: Matthew | Hi Matthew,\nContacts: no contact named Matthew\nsee you at 7.')).toEqual({
      name: 'Matthew',
      draft: 'Hi Matthew,\nsee you at 7.',
      reason: 'no contact named Matthew',
    });
  });

  it('is not shown for a line that has its number, and a Contacts: line elsewhere is plain notes', () => {
    expect(parseTextAction('Text: Matthew Steele <+15551230001> | Hi\nContacts: two contacts match Matthew')).toEqual({ name: 'Matthew Steele', number: '+15551230001', draft: 'Hi' });
    expect(parseTextAction('Text: Matthew | Hi\n\nContacts: two contacts match Matthew')).toEqual({ name: 'Matthew', draft: 'Hi' });
  });
});

describe('the field that adds a number', () => {
  it("is named for the person: Add Matthew's number", () => {
    expect(textNumberLabel({ name: 'Matthew' })).toBe("Add Matthew's number");
  });
});

describe('a number he types', () => {
  it.each([
    ['+1 555 123 0001', '+15551230001'],
    ['(555) 123-0001', '+15551230001'],
    ['555.123.0001', '+15551230001'],
    ['1 555 123 0001', '+15551230001'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s is taken as %s', (typed, number) => {
    expect(parsePhoneNumber(typed)).toEqual({ number });
  });

  it.each([
    ['', 'Type a number'],
    ['   ', 'Type a number'],
    ['call me', 'A number has only digits'],
    ['555 1234', 'Add the area code'],
    ['12345678901234567', 'That number is too long'],
    ['44 20 7946 0958', 'Start a number from abroad with + and its country code'],
  ])('%j is refused: %s', (typed, problem) => {
    expect(parsePhoneNumber(typed)).toEqual({ problem });
  });
});

describe('writing the number into the notes', () => {
  it("puts '<number>' after the name, keeps the draft and the rest, and drops the reason line", () => {
    const notes = 'Ask him.\n\nText: Matthew | Running ten late\nContacts: two contacts match Matthew\n\nOpen: [Maps](geo:0,0?q=x)';
    expect(withTextNumber(notes, '+15551230001')).toBe('Ask him.\n\nText: Matthew <+15551230001> | Running ten late\n\nOpen: [Maps](geo:0,0?q=x)');
  });

  it('keeps a list or bold mark before the Text:', () => {
    expect(withTextNumber('- **Text:** Matthew | Hi', '+15551230001')).toBe('- **Text:** Matthew <+15551230001> | Hi');
  });

  it('reads back as the same name with the new number and no reason', () => {
    const written = withTextNumber('Text: Matthew | Hi\nContacts: no contact named Matthew', '+15551230001') as string;
    expect(parseTextAction(written)).toEqual({ name: 'Matthew', number: '+15551230001', draft: 'Hi' });
  });

  it('gives nothing for notes with no name-only Text: line', () => {
    expect(withTextNumber('Just notes', '+15551230001')).toBeUndefined();
    expect(withTextNumber('Text: Hi there', '+15551230001')).toBeUndefined();
    expect(withTextNumber('Text: Matthew Steele <+15551230001> | Hi', '+15165550123')).toBeUndefined();
  });
});
