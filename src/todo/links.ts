// src/todo/links.ts — the links on a To do card's front (mw-ev7oyy.12): the markdown links of the 'Open:'
// line of its notes, each a chip that opens the app it names (Kindle, Audible, the dialer, a map…). Pure:
// no React. This is the one place that knows what a link is: LINK_KINDS is a table, a row per kind with how
// a url is recognised and how it opens; a new kind is one row here and one case in tests/unit/todo-links.test.ts.
// The board draws only what linkProps() gives it. A 'Text:' line is the card's text action (mw-ev7oyy.22): who to
// text and a draft, drawn as a Text button that opens his texting app with the person and the message filled in;
// textHref() is the one place it is built. On Android it names Google Voice (mw-ev7oyy.23): a plain sms: link goes to
// the phone's default texting app, and Voice is not his default.

/** A link of an 'Open:' line: its own words, which are the chip's label, and where it goes. */
export interface OpenLink {
  text: string;
  url: string;
}

export type LinkOpens = 'same-tab' | 'new-tab';

export interface LinkKind {
  /** The kind's name, for a test or a style: kindle, audible, call, text, map, podcast, web, app. */
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
  { kind: 'text', matches: ({ scheme }) => scheme === 'sms' || scheme === 'smsto' },
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

/** Google Voice's Android package: the app he texts from. */
const GOOGLE_VOICE = 'com.google.android.apps.googlevoice';

const onAndroid = (userAgent: string) => /\bAndroid\b/i.test(userAgent);

/** An sms: or smsto: link as a Chrome intent: link naming Google Voice (mw-ev7oyy.23): on Android a plain one goes to the
 * phone's default texting app, and Voice is not his default. intent:<the link after its scheme>#Intent;scheme=<its
 * scheme>;package=<Voice>;<extras>S.browser_fallback_url=<the link>;end: Android's Intent.parseUri swaps 'intent:' for the
 * scheme, so Voice is handed the very link Chrome would open ('intent://' would make it sms://). Chrome takes only an
 * http(s) fallback, so the link as fallback serves other browsers. */
function voiceIntent(url: string, scheme: string, extras = ''): string {
  return `intent:${url.slice(scheme.length + 1)}#Intent;scheme=${scheme};package=${GOOGLE_VOICE};${extras}S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** The attributes of the anchor that opens a link on a phone with this user agent: what the board spreads onto its <a>.
 * A text link on Android opens Google Voice by name. */
export function linkProps(link: OpenLink, userAgent: string): { href: string; 'data-kind': string; target?: '_blank'; rel?: string } {
  const { row, scheme } = rowOf(link.url);
  const href = row.kind === 'text' && onAndroid(userAgent) ? voiceIntent(link.url, scheme) : link.url;
  return { href, 'data-kind': row.kind, ...(linkOpens(link.url) === 'new-tab' ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {}) };
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

/** A card's text action, from the 'Text:' line of its notes: who a tap texts (a name and/or a number, either may be
 * absent) and the message filled in for him to send. */
export interface TextAction {
  name?: string;
  /** Only digits and a leading '+'. Absent, the texting app opens with the message and he picks the person. */
  number?: string;
  draft: string;
}

/** A line that opens with 'Text:', set as the 'Open:' line may be (a list item, a quote, in bold). */
const TEXT_LINE = /^[\s>*+-]*(?:\*\*|__)?Text:(?:\*\*|__)?(.*)$/;
/** A phone number as it is written: an optional '+' and '(', then digits with spaces, dots, dashes and brackets between. */
const PHONE = /\+?\(?\d[\d\s().-]*\d/;
/** Edge punctuation left on a name once its number is taken out: 'Dad (+1 516 555 0123)' is 'Dad'. */
const NAME_EDGES = /^[\s,;:()–—-]+|[\s,;:()–—-]+$/g;

function whoOf(who: string): { name?: string; number?: string } {
  const written = PHONE.exec(who)?.[0];
  const digits = written?.replace(/\D/g, '') ?? '';
  if (!written || digits.length < 3) {
    const name = who.trim();
    return name ? { name } : {};
  }
  const name = who.replace(written, ' ').replace(/\(\s*\)/g, ' ').replace(NAME_EDGES, '').trim();
  return { ...(name ? { name } : {}), number: `${written.trim().startsWith('+') ? '+' : ''}${digits}` };
}

/** The text action of a description: its first 'Text:' line, 'Text: <name and/or number> | <draft>' or 'Text: <draft>'
 * (no bar, no one named). The draft runs on, a line for a line, to the end of its paragraph: a blank line, or an
 * 'Open:' or another 'Text:' line. None when there is no such line, or it names no number and holds no draft. */
export function parseTextAction(description: string): TextAction | undefined {
  const lines = description.split(/\r?\n/);
  const at = lines.findIndex((line) => TEXT_LINE.test(line));
  if (at < 0) return undefined;
  const rest = TEXT_LINE.exec(lines[at])?.[1] ?? '';
  const bar = rest.indexOf('|');
  const who = bar < 0 ? {} : whoOf(rest.slice(0, bar));
  const draftLines = [(bar < 0 ? rest : rest.slice(bar + 1)).trim()];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || TEXT_LINE.test(line) || OPEN_LINE.test(line)) break;
    draftLines.push(line.trim());
  }
  const draft = draftLines.join('\n').trim();
  if (!draft && !who.number) return undefined;
  return { ...who, draft };
}

/** A lone half of a surrogate pair, which encodeURIComponent will not take. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const encodeDraft = (draft: string) => encodeURIComponent(draft.replace(LONE_SURROGATE, '\uFFFD'));

/** Today's link everywhere but Android: sms:<number>?body=<draft>, the number left out when there is none and the body
 * when the draft is empty. The draft is percent-encoded whole (&, ?, #, a newline, '+', an emoji), so the app gets every word. */
function smsHref(action: TextAction): string {
  return `sms:${action.number ?? ''}${action.draft ? `?body=${encodeDraft(action.draft)}` : ''}`;
}

/** The Text button's link for a phone with this user agent. On Android, the sms: link as an intent: link naming Google
 * Voice (voiceIntent), the draft also in the sms_body extra (Android's documented field for it), whichever Voice reads.
 * Anywhere else, today's sms: link. */
export function textHref(action: TextAction, userAgent: string): string {
  const sms = smsHref(action);
  return onAndroid(userAgent) ? voiceIntent(sms, 'sms', action.draft ? `S.sms_body=${encodeDraft(action.draft)};` : '') : sms;
}

/** What the Text button says: who a tap texts, by name, else by number, else only 'Text'. */
export function textLabel(action: TextAction): string {
  const who = action.name ?? action.number;
  return who ? `Text ${who}` : 'Text';
}
