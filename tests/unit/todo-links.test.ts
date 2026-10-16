// tests/unit/todo-links.test.ts — mw-ev7oyy.12: the 'Open:' line of a card's description as link chips.
// src/todo/links.ts holds the table of link kinds; a new kind is one row there and one case in KINDS below.
import { describe, expect, it } from 'vitest';
import { LINK_KINDS, MAX_OPEN_LINKS, linkKind, linkOpens, linkProps, openLinkLabel, openLinkName, openLinksOf, parseOpenLinks } from '../../src/todo';

const KINDLE = 'kindle://book?action=open&asin=B0C74TJ712';
const AUDIBLE = 'https://www.audible.com/pd/B0CC36V9KG';

describe('the Open: line parser', () => {
  it('returns the text and url of each markdown link on the line, in order', () => {
    expect(parseOpenLinks(`Read this one.\n\nOpen: [Kindle](${KINDLE}) · [Audible](${AUDIBLE})`)).toEqual([
      { text: 'Kindle', url: KINDLE },
      { text: 'Audible', url: AUDIBLE },
    ]);
  });

  it('tolerates a middle dot, a comma, a bar or spaces between the links', () => {
    for (const between of [' · ', ', ', ' ', '·', ',', ' | ']) {
      expect(parseOpenLinks(`Open: [A](https://a.example/x)${between}[B](https://b.example/y)`).map((link) => link.text)).toEqual(['A', 'B']);
    }
  });

  it('ignores bare urls, whether on the line or elsewhere, and links outside an Open: line', () => {
    const text = ['See https://example.com/bare and [Elsewhere](https://elsewhere.example/)', 'Open: https://bare.example/z [Kept](https://kept.example/)', 'Not open: [Nope](https://nope.example/)'].join('\n');
    expect(parseOpenLinks(text)).toEqual([{ text: 'Kept', url: 'https://kept.example/' }]);
  });

  it('reads an Open: line set as a list item or in bold, and every such line in the description', () => {
    const text = `- **Open:** [One](https://one.example/)\n* Open: [Two](https://two.example/)\n> Open: [Three](https://three.example/)`;
    expect(parseOpenLinks(text).map((link) => link.text)).toEqual(['One', 'Two', 'Three']);
  });

  it('keeps at most four, the first four', () => {
    const links = [1, 2, 3, 4, 5].map((n) => `[L${n}](https://l${n}.example/)`).join(' · ');
    expect(MAX_OPEN_LINKS).toBe(4);
    expect(parseOpenLinks(`Open: ${links}`).map((link) => link.text)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  it('finds none in a description with no Open: line, or an empty one', () => {
    expect(parseOpenLinks('Just notes. [A link](https://a.example/)')).toEqual([]);
    expect(parseOpenLinks('')).toEqual([]);
  });

  it('never offers a script, data or file link', () => {
    expect(parseOpenLinks('Open: [x](javascript:alert(1)) [y](data:text/html,hi) [z](file:///etc/passwd) [ok](https://ok.example/)')).toEqual([{ text: 'ok', url: 'https://ok.example/' }]);
  });

  it('keeps a url exactly as written, already encoded by the Mayor, never encoded again (mw-ev7oyy.22 sweep)', () => {
    const MAP = 'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20Roma%20%26%20Bar';
    expect(parseOpenLinks(`Open: [Café](${MAP}) [Call](tel:+1-516-555-0123)`)).toEqual([
      { text: 'Café', url: MAP },
      { text: 'Call', url: 'tel:+1-516-555-0123' },
    ]);
    expect(linkProps({ text: 'Café', url: MAP }, '').href).toBe(MAP);
  });

  it('is what lists.ts hands a card', () => {
    expect(openLinksOf(`Open: [Kindle](${KINDLE})`)).toEqual([{ text: 'Kindle', url: KINDLE }]);
  });
});

// mw-ev7oyy.17: the Governor's Deep Discipleship card holds an Open: line per book, and its chips read 'Kindle, Audible, Kindle, Audible'.
describe('several Open: lines, one per book (mw-ev7oyy.17)', () => {
  const KINDLE_2 = 'kindle://book?action=open&asin=B07ZJZ1X3K';
  const AUDIBLE_2 = 'https://www.audible.com/pd/B07ZJYQWXR';
  const TWO_BOOKS = `Week 5's reading.\n\nOpen: Deep Discipleship [Kindle](${KINDLE}) · [Audible](${AUDIBLE})\nOpen: **You Are a Theologian** — [Kindle](${KINDLE_2}) · [Audible](${AUDIBLE_2})`;

  it('gives four chips, each label naming its book after the app, and each named for a screen reader by book and app', () => {
    const links = parseOpenLinks(TWO_BOOKS);
    expect(links.map((link) => link.url)).toEqual([KINDLE, AUDIBLE, KINDLE_2, AUDIBLE_2]);
    expect(links.map(openLinkLabel)).toEqual(['Kindle · Deep Discipleship', 'Audible · Deep Discipleship', 'Kindle · You Are a Theologian', 'Audible · You Are a Theologian']);
    expect(links.map(openLinkName)).toEqual(['Open Deep Discipleship in Kindle', 'Open Deep Discipleship in Audible', 'Open You Are a Theologian in Kindle', 'Open You Are a Theologian in Audible']);
    expect(new Set(links.map(openLinkLabel)).size).toBe(4);
  });

  it('keeps today\'s labels for one Open: line, words before its links or not', () => {
    for (const text of [`Open: [Kindle](${KINDLE}) · [Audible](${AUDIBLE})`, `Open: Deep Discipleship [Kindle](${KINDLE}) · [Audible](${AUDIBLE})`]) {
      const links = parseOpenLinks(text);
      expect(links.map(openLinkLabel)).toEqual(['Kindle', 'Audible']);
      expect(links.map(openLinkName)).toEqual(['Open in Kindle', 'Open in Audible']);
    }
  });

  it('names a line with nothing before its links by the link text alone, and does not count a line with no chip of its own', () => {
    const links = parseOpenLinks(`Open: [Deep Discipleship on Kindle](${KINDLE})\nOpen: Theologian: [Kindle](${KINDLE_2})`);
    expect(links.map(openLinkLabel)).toEqual(['Deep Discipleship on Kindle', 'Kindle · Theologian']);
    expect(parseOpenLinks(`Open: Deep Discipleship [Kindle](${KINDLE})\nOpen: nothing here https://bare.example/`).map(openLinkLabel)).toEqual(['Kindle']);
  });

  it('is what lists.ts hands a card', () => {
    expect(openLinksOf(TWO_BOOKS).map(openLinkLabel)).toEqual(parseOpenLinks(TWO_BOOKS).map(openLinkLabel));
  });
});

// One case per row of LINK_KINDS: a url the row recognises, the kind it names, and whether a tap opens a new tab.
const KINDS: { kind: string; url: string; newTab: boolean }[] = [
  { kind: 'kindle', url: KINDLE, newTab: false },
  { kind: 'audible', url: AUDIBLE, newTab: true },
  { kind: 'call', url: 'tel:+15555550123', newTab: false },
  { kind: 'text', url: 'sms:+15555550123?body=Hi', newTab: false },
  { kind: 'email', url: 'mailto:luke@example.com?subject=Hi', newTab: false },
  { kind: 'map', url: 'https://maps.app.goo.gl/AbCd123', newTab: true },
  { kind: 'map', url: 'https://www.google.com/maps/place/Home', newTab: true },
  { kind: 'map', url: 'geo:37.78,-122.41', newTab: false },
  { kind: 'podcast', url: 'https://pca.st/episode/abc', newTab: true },
  { kind: 'podcast', url: 'https://open.spotify.com/episode/abc', newTab: true },
  { kind: 'podcast', url: 'https://podcasts.apple.com/us/podcast/x/id1', newTab: true },
  { kind: 'web', url: 'https://example.com/page', newTab: true },
  { kind: 'app', url: 'logosres:biblia;ref=John3', newTab: false },
];

describe('an Open: chip on Android (mw-ev7oyy.23 sweep)', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const COMPUTER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  it('opens an sms: or smsto: link in Google Voice by name, not the default texting app, falling back to the link itself', () => {
    expect(linkProps({ text: 'Text Dad', url: 'sms:+15555550123?body=Hi%20Dad' }, ANDROID)).toEqual({
      href: `intent:+15555550123?body=Hi%20Dad#Intent;scheme=sms;package=com.google.android.apps.googlevoice;S.browser_fallback_url=${encodeURIComponent('sms:+15555550123?body=Hi%20Dad')};end`,
      'data-kind': 'text',
    });
    expect(linkProps({ text: 'Text Dad', url: 'SMSTO:+15555550123' }, ANDROID).href).toBe(
      `intent:+15555550123#Intent;scheme=smsto;package=com.google.android.apps.googlevoice;S.browser_fallback_url=${encodeURIComponent('SMSTO:+15555550123')};end`,
    );
  });

  it('leaves an sms: link as it is elsewhere, and every other kind as it is on Android too', () => {
    expect(linkProps({ text: 'Text Dad', url: 'sms:+15555550123?body=Hi' }, COMPUTER).href).toBe('sms:+15555550123?body=Hi');
    for (const { url } of KINDS.filter(({ kind }) => kind !== 'text')) expect(linkProps({ text: 'x', url }, ANDROID).href).toBe(url);
  });
});

describe('the table of link kinds', () => {
  it.each(KINDS)('$url is $kind', ({ kind, url, newTab }) => {
    expect(linkKind(url)).toBe(kind);
    expect(linkOpens(url)).toBe(newTab ? 'new-tab' : 'same-tab');
  });

  it('gives a tel: link the same tab, for the dialer, and an audible.com one the audible kind', () => {
    expect(linkOpens('tel:+15555550123')).toBe('same-tab');
    expect(linkKind('https://www.audible.com/pd/B0CC36V9KG?ref=x')).toBe('audible');
    expect(linkKind('https://notaudible.com/pd/x')).toBe('web');
  });

  it('has one row per kind named, none twice', () => {
    const names = LINK_KINDS.map((row) => row.kind);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['kindle', 'audible', 'call', 'map', 'podcast', 'web']) expect(names).toContain(name);
  });

  it('is named, every row of it, in the KINDS cases above (mw-ev7oyy.24 sweep)', () => {
    const tested = new Set(KINDS.map(({ kind }) => kind));
    expect([...tested].sort()).toEqual(LINK_KINDS.map((row) => row.kind).sort());
  });
});
