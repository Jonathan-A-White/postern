// src/todo/links.ts — the links on a To do card's front (mw-ev7oyy.12): the markdown links of the 'Open:'
// line of its notes, each a chip that opens the app it names (Kindle, Audible, the dialer, a map…). Pure:
// no React. This is the one place that knows what a link is: LINK_KINDS is a table, a row per kind with how
// a url is recognised and how it opens; a new kind is one row here and one case in tests/unit/todo-links.test.ts.
// The board draws only what linkProps() gives it. A 'Text:' line is the card's text action (mw-ev7oyy.22): who to
// text and a draft, drawn as a Text button that opens his texting app with the person and the message filled in;
// textHref() is the one place it is built. On Android it names Google Voice (mw-ev7oyy.23): a plain sms: link goes to
// the phone's default texting app, and Voice is not his default. An 'Audible:' or a 'Listen:' line, or an audible.com/pd/ link, is
// the card's listen action (mw-ev7oyy.24): a Listen in Audible button whose link audible-kit builds (listenHref), at a chapter's start
// when the card names one. An 'Email:' line is the card's email action (mw-ev7oyy.26): who to write to, a subject and a draft,
// drawn as an Email button after the Text one, whose mailto: link (emailHref) Android hands to his default mail app (Gmail).
// Notes with an 'Open:' line per book name each chip by its line (mw-ev7oyy.17): openLinkLabel and openLinkName are the one rule for it.
import { BIBLE_BOOKS, WORD_OF_PROMISE_ASIN, audibleLink, wordOfPromiseStart } from 'audible-kit';

/** A link of an 'Open:' line: its own words, which are the chip's label, and where it goes. */
export interface OpenLink {
  text: string;
  url: string;
  /** The short name of its line, when the notes hold more than one 'Open:' line (mw-ev7oyy.17): the words before the line's links,
   * 'Deep Discipleship' in 'Open: Deep Discipleship [Kindle](…) · [Audible](…)'. Absent with one line, or a line with no words before its links. */
  line?: string;
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
  { kind: 'email', matches: ({ scheme }) => scheme === 'mailto' },
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
 * http(s) fallback, so the link as fallback serves other browsers. Only for a link that names a recipient (mw-ev7oyy.28):
 * no Voice activity resolves an sms: link without one, and Chrome sends a named package that resolves nothing to its Play Store page. */
function voiceIntent(url: string, scheme: string, extras = ''): string {
  return `intent:${url.slice(scheme.length + 1)}#Intent;scheme=${scheme};package=${GOOGLE_VOICE};${extras}S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** Google Voice's own launcher as an intent: link (mw-ev7oyy.28): the one thing Voice always resolves, so a text with no
 * recipient opens the app itself, never its Play Store page. The draft cannot ride along (Voice reads none without a
 * recipient), so the board copies it first (textCopyDraft) and says so. */
function voiceLauncher(url: string): string {
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${GOOGLE_VOICE};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** An sms: or smsto: link taken apart: the recipient (after the scheme, before any '?') and the decoded body. */
function smsParts(url: string, scheme: string): { recipient: string; body: string } {
  const rest = url.slice(scheme.length + 1);
  const query = rest.indexOf('?');
  const recipient = (query < 0 ? rest : rest.slice(0, query)).trim();
  let body = '';
  for (const pair of query < 0 ? [] : rest.slice(query + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).toLowerCase() === 'body') {
      try {
        body = decodeURIComponent(pair.slice(eq + 1));
      } catch {
        body = pair.slice(eq + 1);
      }
    }
  }
  return { recipient, body };
}

/** The Android link for an sms: or smsto: link: Voice by name with the draft also as the sms_body extra when it names a recipient,
 * else Voice's launcher (smsParts, voiceLauncher). */
function androidSmsHref(url: string, scheme: string): string {
  const { recipient, body } = smsParts(url, scheme);
  return recipient ? voiceIntent(url, scheme, body ? `S.sms_body=${encodeDraft(body)};` : '') : voiceLauncher(url);
}

/** The attributes of the anchor that opens a link on a phone with this user agent: what the board spreads onto its <a>.
 * A text link on Android opens Google Voice by name. */
export function linkProps(link: OpenLink, userAgent: string): { href: string; 'data-kind': string; target?: '_blank'; rel?: string } {
  const { row, scheme } = rowOf(link.url);
  const href = row.kind === 'text' && onAndroid(userAgent) ? androidSmsHref(link.url, scheme) : link.url;
  return { href, 'data-kind': row.kind, ...(linkOpens(link.url) === 'new-tab' ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {}) };
}

/** The draft a tap on an 'Open:' sms: chip copies before Voice opens, on Android only and only when the link names no one (mw-ev7oyy.28). */
export function linkCopyDraft(link: OpenLink, userAgent: string): string | undefined {
  const { row, scheme } = rowOf(link.url);
  if (row.kind !== 'text' || !onAndroid(userAgent)) return undefined;
  const { recipient, body } = smsParts(link.url, scheme);
  return !recipient && body ? body : undefined;
}

/** A line that opens with 'Open:' (as a list item, a quote or in bold, too) and what follows it. */
const OPEN_LINE = /^[\s>*+-]*(?:\*\*|__)?Open:(?:\*\*|__)?(.*)$/;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** Schemes that run or read something instead of opening an app: never a chip. */
const NEVER = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about']);

/** Emphasis marks, and the punctuation left at the edges of a line's name: 'Open: **Theologian** — [Kindle](…)' is 'Theologian'. */
const NAME_MARKS = /[*_`]/g;
const LINE_NAME_EDGES = /^[\s:·|,;–—-]+|[\s:·|,;–—-]+$/g;

/** The markdown links of the 'Open:' lines of a description, in order, at most MAX_OPEN_LINKS. Bare urls and links on other lines are left out.
 * When more than one line gives a chip, each link carries its line's name (mw-ev7oyy.17). */
export function parseOpenLinks(description: string): OpenLink[] {
  const lines: { name: string; links: OpenLink[] }[] = [];
  for (const line of description.split(/\r?\n/)) {
    const rest = OPEN_LINE.exec(line)?.[1];
    if (rest === undefined) continue;
    const links: OpenLink[] = [];
    let first: number | undefined;
    for (const match of rest.matchAll(MARKDOWN_LINK)) {
      const [, text, url] = match;
      first ??= match.index;
      const scheme = describe(url).scheme;
      if (!scheme || NEVER.has(scheme) || !text.trim()) continue;
      links.push({ text: text.trim(), url });
    }
    if (links.length) lines.push({ name: rest.slice(0, first).replace(NAME_MARKS, '').replace(LINE_NAME_EDGES, '').trim(), links });
  }
  const named = lines.length > 1;
  return lines.flatMap(({ name, links }) => links.map((link) => (named && name ? { ...link, line: name } : link))).slice(0, MAX_OPEN_LINKS);
}

/** What a chip says: the link's own words, then its line's name when it has one ('Kindle · Deep Discipleship'). */
export function openLinkLabel(link: OpenLink): string {
  return link.line ? `${link.text} · ${link.line}` : link.text;
}

/** What a chip is named for a screen reader: what a tap opens, and in what ('Open Deep Discipleship in Kindle', else 'Open in Kindle'). */
export function openLinkName(link: OpenLink): string {
  return link.line ? `Open ${link.line} in ${link.text}` : `Open in ${link.text}`;
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
/** A line that opens with 'Email:', set the same way (mw-ev7oyy.26). Named here, for a Text: draft ends where an Email: line begins. */
const EMAIL_LINE = /^[\s>*+-]*(?:\*\*|__)?Email:(?:\*\*|__)?(.*)$/;
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
    if (!line.trim() || TEXT_LINE.test(line) || OPEN_LINE.test(line) || EMAIL_LINE.test(line)) break;
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
 * Voice (voiceIntent), the draft also in the sms_body extra (Android's documented field for it), whichever Voice reads;
 * with no number, Voice's own launcher instead (mw-ev7oyy.28), never an intent that can end at the Play Store.
 * Anywhere else, today's sms: link. */
export function textHref(action: TextAction, userAgent: string): string {
  const sms = smsHref(action);
  if (!onAndroid(userAgent)) return sms;
  return action.number ? voiceIntent(sms, 'sms', action.draft ? `S.sms_body=${encodeDraft(action.draft)};` : '') : voiceLauncher(sms);
}

/** The draft a tap on the Text button copies before Voice opens: on Android, a line with no number (Voice opens without a
 * recipient to hand the draft to, so he picks the person and pastes it). None anywhere else, or with a number or no draft. */
export function textCopyDraft(action: TextAction, userAgent: string): string | undefined {
  return onAndroid(userAgent) && !action.number && action.draft ? action.draft : undefined;
}

/** The toast after the draft is copied for a text with no number: 'Draft copied: pick Matthew Steele and paste'. */
export function copyNotice(who?: string): string {
  return `Draft copied: pick ${who ?? 'the person'} and paste`;
}

/** What the Text button says: who a tap texts, by name, else by number, else only 'Text'. */
export function textLabel(action: TextAction): string {
  const who = action.name ?? action.number;
  return who ? `Text ${who}` : 'Text';
}

/** A card's email action, from the 'Email:' line of its notes (mw-ev7oyy.26): who a tap writes to, and the subject and
 * draft filled in for him to send. */
export interface EmailAction {
  name?: string;
  /** The one address the line names: without it there is no action. */
  address: string;
  /** Empty when the line gives none. */
  subject: string;
  /** Empty when the line gives none; line breaks kept. */
  draft: string;
}

/** An address as it is written: a local part, '@', and a dotted domain. No quote, bracket, comma, colon, bar or space in it. */
const ADDRESS = /[^\s<>()[\]{}"',;:|@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
/** Edge punctuation left on a name once its address is taken out: 'Luke <luke@x.com>' is 'Luke'. */
const EMAIL_EDGES = /^[\s,;:()<>–—-]+|[\s,;:()<>–—-]+$/g;

/** The email action of a description: its first 'Email:' line, 'Email: <name> <address> | <subject> | <draft>'. The name is
 * optional, the address is not; the draft is whatever follows the second bar (bars in it are its own) and runs on, a line for a
 * line, to the end of its paragraph: a blank line, or an 'Open:', 'Text:' or another 'Email:' line. None when there is no such
 * line, or its first part holds no address (the line is then only text on the card's back). */
export function parseEmailAction(description: string): EmailAction | undefined {
  const lines = description.split(/\r?\n/);
  const at = lines.findIndex((line) => EMAIL_LINE.test(line));
  if (at < 0) return undefined;
  const rest = EMAIL_LINE.exec(lines[at])?.[1] ?? '';
  const [who, subject = '', ...more] = rest.split('|');
  const address = ADDRESS.exec(who)?.[0];
  if (!address) return undefined;
  const name = who.replace(address, ' ').replace(/mailto:/gi, '').replace(EMAIL_EDGES, '').trim();
  const draftLines = [more.join('|').trim()];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || TEXT_LINE.test(line) || OPEN_LINE.test(line) || EMAIL_LINE.test(line)) break;
    draftLines.push(line.trim());
  }
  return { ...(name ? { name } : {}), address, subject: subject.trim(), draft: draftLines.join('\n').trim() };
}

/** A mailto: field's value, percent-encoded whole (&, ?, #, '+', '%', a space, an emoji) so the mail app gets every character. A
 * line break goes as %0D%0A, which RFC 6068 asks of a mailto: body. */
const encodeMail = (text: string) => encodeURIComponent(text.replace(LONE_SURROGATE, '\uFFFD').replace(/\r?\n/g, '\r\n'));

/** The Email button's link: mailto:<address>?subject=<subject>&body=<draft>, each field left out when empty. The address
 * keeps its '@' and '+', which a mailto: link may carry as they are. Android hands the link to his default mail app (Gmail). */
export function emailHref(action: EmailAction): string {
  const fields = [action.subject && `subject=${encodeMail(action.subject)}`, action.draft && `body=${encodeMail(action.draft)}`].filter(Boolean);
  return `mailto:${encodeURIComponent(action.address).replace(/%40/g, '@').replace(/%2B/g, '+')}${fields.length ? `?${fields.join('&')}` : ''}`;
}

/** What the Email button says: who a tap writes to, by name, else by address. */
export function emailLabel(action: EmailAction): string {
  return `Email ${action.name ?? action.address}`;
}

/** What a card's Listen in Audible button opens (mw-ev7oyy.24): an Audible book, and where in it. */
export interface ListenAction {
  /** The book's Audible id. */
  asin: string;
  /** Where the chapter starts, in milliseconds. Absent, the book opens where Audible left it. */
  positionMs?: number;
  /** The book is one file (Audible calls it a SinglePartBook), not many. */
  single?: boolean;
}

/** An 'Audible: <ASIN>' line, set as the 'Open:' line may be; what follows the id is read for the word 'single'. */
const AUDIBLE_LINE = /^[\s>*+-]*(?:\*\*|__)?Audible:(?:\*\*|__)?\s*(\S*)(.*)$/;
/** A 'Listen:' line: a Bible chapter ('Luke 15'), or a chapter of the Audible book ('You Are a Theologian ch 6 | 7733124'). */
const LISTEN_LINE = /^[\s>*+-]*(?:\*\*|__)?Listen:(?:\*\*|__)?(.*)$/;
const ASIN = /^[A-Z0-9]{10}$/;
/** An audible.com/pd/ link, with or without the title's slug in the path, anywhere in the notes. */
const PD_LINK = /https?:\/\/(?:[\w-]+\.)*audible\.com\/pd\/(?:[^\s/)]+\/)?([A-Z0-9]{10})(?![A-Za-z0-9])/;
const CHAPTER_OF = /^(.+?)\s+(?:(?:chapter|ch\.?)\s*)?(\d+)$/i;

/** The Bible's books by lower-case name, with the two spellings Audible itself uses for Psalms and Revelation. */
const BOOKS = new Map<string, (typeof BIBLE_BOOKS)[number]>([
  ...BIBLE_BOOKS.map((book) => [book.name.toLowerCase(), book] as const),
  ['psalm', BIBLE_BOOKS.find((book) => book.name === 'Psalms')!],
  ['revelations', BIBLE_BOOKS.find((book) => book.name === 'Revelation')!],
]);

/** The Word of Promise's chapter a 'Listen:' line names ('Luke 15', 'Psalm 23', 'Obadiah'), or none. */
function bibleChapter(words: string): ListenAction | undefined {
  const chapter = CHAPTER_OF.exec(words);
  const book = BOOKS.get((chapter?.[1] ?? words).replace(/\s+/g, ' ').toLowerCase());
  const number = chapter ? Number(chapter[2]) : 1;
  const positionMs = book && (chapter || book.chapters === 1) ? wordOfPromiseStart(book.name, number) : undefined;
  return positionMs === undefined ? undefined : { asin: WORD_OF_PROMISE_ASIN, positionMs };
}

/** The listen action of a description, or none. The book is the id of its 'Audible: <ASIN>' line (then 'single' for a book that
 * is one file), else the first audible.com/pd/<ASIN> link. A 'Listen: <Book> <chapter>' line (Luke 15) opens The Word of Promise
 * at that chapter's start, from audible-kit's data. A 'Listen: <title> ch <n> | <start in ms>' line opens the Audible book at
 * that chapter's start: api.audible.com sends a browser no CORS header, so the board cannot ask it, and the start is written
 * into the line (audible-kit's fetchChapterStarts reads it) when the card is filed. A chapter the board cannot place opens the book. */
export function parseListenAction(description: string): ListenAction | undefined {
  const lines = description.split(/\r?\n/);
  let book: ListenAction | undefined;
  for (const line of lines) {
    const found = AUDIBLE_LINE.exec(line);
    if (found && ASIN.test(found[1])) {
      book = { asin: found[1], ...(/\bsingle\b/i.test(found[2]) ? { single: true } : {}) };
      break;
    }
  }
  const pd = PD_LINK.exec(description)?.[1];
  book ??= pd ? { asin: pd } : undefined;
  const listen = lines.map((line) => LISTEN_LINE.exec(line)?.[1]).find((rest) => rest !== undefined);
  if (listen !== undefined) {
    const bar = listen.indexOf('|');
    if (bar < 0) {
      const chapter = bibleChapter(listen.trim());
      if (chapter) return chapter;
    } else if (book) {
      const start = /^\s*(\d+)\s*$/.exec(listen.slice(bar + 1))?.[1];
      if (start !== undefined) return { ...book, positionMs: Number(start) };
    }
  }
  return book;
}

/** The link a tap on the Listen in Audible button opens, built by audible-kit. Audible wants a positioned link stamped with the
 * time of the tap, so the board asks for it when it is tapped (now is for a test). */
export function listenHref(action: ListenAction, now?: number): string {
  return audibleLink({ asin: action.asin, ...(action.positionMs !== undefined ? { positionMs: action.positionMs } : {}), ...(action.single ? { contentDeliveryType: 'SinglePartBook' as const } : {}), ...(now !== undefined ? { now } : {}) });
}
