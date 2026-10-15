// tests/unit/todo-links.test.ts — mw-ev7oyy.12: the 'Open:' line of a card's description as link chips.
// src/todo/links.ts holds the table of link kinds; a new kind is one row there and one case in KINDS below.
import { describe, expect, it } from 'vitest';
import { LINK_KINDS, MAX_OPEN_LINKS, linkKind, linkOpens, openLinksOf, parseOpenLinks } from '../../src/todo';

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

  it('is what lists.ts hands a card', () => {
    expect(openLinksOf(`Open: [Kindle](${KINDLE})`)).toEqual([{ text: 'Kindle', url: KINDLE }]);
  });
});

// One case per row of LINK_KINDS: a url the row recognises, the kind it names, and whether a tap opens a new tab.
const KINDS: { kind: string; url: string; newTab: boolean }[] = [
  { kind: 'kindle', url: KINDLE, newTab: false },
  { kind: 'audible', url: AUDIBLE, newTab: true },
  { kind: 'call', url: 'tel:+15555550123', newTab: false },
  { kind: 'map', url: 'https://maps.app.goo.gl/AbCd123', newTab: true },
  { kind: 'map', url: 'https://www.google.com/maps/place/Home', newTab: true },
  { kind: 'map', url: 'geo:37.78,-122.41', newTab: false },
  { kind: 'podcast', url: 'https://pca.st/episode/abc', newTab: true },
  { kind: 'podcast', url: 'https://open.spotify.com/episode/abc', newTab: true },
  { kind: 'podcast', url: 'https://podcasts.apple.com/us/podcast/x/id1', newTab: true },
  { kind: 'web', url: 'https://example.com/page', newTab: true },
  { kind: 'app', url: 'logosres:biblia;ref=John3', newTab: false },
];

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
});
