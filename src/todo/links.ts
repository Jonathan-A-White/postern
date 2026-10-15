// src/todo/links.ts — the links on a To do card's front (mw-ev7oyy.12): the markdown links of the 'Open:'
// line of its notes, each a chip that opens the app it names (Kindle, Audible, the dialer, a map…). Pure:
// no React. This is the one place that knows what a link is: LINK_KINDS is a table, a row per kind with how
// a url is recognised and how it opens; a new kind is one row here and one case in tests/unit/todo-links.test.ts.
// The board draws only what linkProps() gives it.

/** A link of an 'Open:' line: its own words, which are the chip's label, and where it goes. */
export interface OpenLink {
  text: string;
  url: string;
}

export type LinkOpens = 'same-tab' | 'new-tab';

export interface LinkKind {
  /** The kind's name, for a test or a style: kindle, audible, call, map, podcast, web, app. */
  kind: string;
  /** Whether this row recognises the url (a lower-cased scheme and host come with it). The first row to say yes owns the link. */
  matches: (link: { url: string; scheme: string; host: string; path: string }) => boolean;
  /** Where a tap opens it; absent, a web page opens in a new tab and any other scheme in this one, which is how Android hands it to its app. */
  opens?: LinkOpens;
}

/** At most this many chips on a card's front. */
export const MAX_OPEN_LINKS = 4;

const onHost = (host: string, ...domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
const isWeb = (scheme: string) => scheme === 'http' || scheme === 'https';

/** The table, most particular first; 'web' and 'app' catch what is left. */
export const LINK_KINDS: readonly LinkKind[] = [
  { kind: 'kindle', matches: ({ scheme }) => scheme === 'kindle' },
  { kind: 'audible', matches: ({ scheme, host }) => isWeb(scheme) && onHost(host, 'audible.com') },
  { kind: 'call', matches: ({ scheme }) => scheme === 'tel' },
  {
    kind: 'map',
    matches: ({ scheme, host, path }) => scheme === 'geo' || (isWeb(scheme) && (host === 'maps.app.goo.gl' || (host === 'goo.gl' && path.startsWith('/maps')) || (onHost(host, 'google.com') && path.startsWith('/maps')))),
  },
  { kind: 'podcast', matches: ({ scheme, host }) => isWeb(scheme) && onHost(host, 'pca.st', 'pocketcasts.com', 'open.spotify.com', 'podcasts.apple.com') },
  { kind: 'web', matches: ({ scheme }) => isWeb(scheme) },
  { kind: 'app', matches: () => true },
];

function describe(url: string): { url: string; scheme: string; host: string; path: string } {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase() ?? '';
  try {
    const parsed = new URL(url);
    return { url, scheme, host: isWeb(scheme) ? parsed.hostname.toLowerCase() : '', path: isWeb(scheme) ? parsed.pathname : '' };
  } catch {
    return { url, scheme, host: '', path: '' };
  }
}

function rowOf(url: string): { row: LinkKind; scheme: string } {
  const link = describe(url);
  return { row: LINK_KINDS.find((candidate) => candidate.matches(link)) ?? LINK_KINDS[LINK_KINDS.length - 1], scheme: link.scheme };
}

/** The kind of a url: the name of the first row of LINK_KINDS that recognises it. */
export function linkKind(url: string): string {
  return rowOf(url).row.kind;
}

/** Where a tap on a url opens it. */
export function linkOpens(url: string): LinkOpens {
  const { row, scheme } = rowOf(url);
  return row.opens ?? (isWeb(scheme) ? 'new-tab' : 'same-tab');
}

/** The attributes of the anchor that opens a link: what the board spreads onto its <a>. */
export function linkProps(link: OpenLink): { href: string; 'data-kind': string; target?: '_blank'; rel?: string } {
  return { href: link.url, 'data-kind': linkKind(link.url), ...(linkOpens(link.url) === 'new-tab' ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {}) };
}

/** A line that opens with 'Open:' (as a list item, a quote or in bold, too) and what follows it. */
const OPEN_LINE = /^[\s>*+-]*(?:\*\*|__)?Open:(?:\*\*|__)?(.*)$/;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** Schemes that run or read something instead of opening an app: never a chip. */
const NEVER = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about']);

/** The markdown links of the 'Open:' lines of a description, in order, at most MAX_OPEN_LINKS. Bare urls and links on other lines are left out. */
export function parseOpenLinks(description: string): OpenLink[] {
  const found: OpenLink[] = [];
  for (const line of description.split(/\r?\n/)) {
    const rest = OPEN_LINE.exec(line)?.[1];
    if (rest === undefined) continue;
    for (const [, text, url] of rest.matchAll(MARKDOWN_LINK)) {
      const scheme = describe(url).scheme;
      if (!scheme || NEVER.has(scheme) || !text.trim()) continue;
      found.push({ text: text.trim(), url });
      if (found.length === MAX_OPEN_LINKS) return found;
    }
  }
  return found;
}
