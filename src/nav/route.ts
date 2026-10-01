// src/nav/route.ts — every place in the cockpit as a URL, so Back, a notification
// tap and a link in a comment all land exactly there. Still a query string (the
// app is served as static files by nginx, with no rewrite rules): `?v=` names
// the view and the rest of the query says where in it. Links the old screens
// used (`?screen=…`, from notifications already delivered) are read too.

import type { MessageClass } from '../data/db';
import type { WaitsFor } from '../model/view';
import { ABOUT_KINDS, type TalkAbout } from '../model/talkLine';

export type MapLens = 'board' | 'graph' | 'list';

export type Route =
  /** `who` is the part of the Needs switch: whose turn the cards are (absent: You). */
  | { view: 'needs'; who?: WaitsFor }
  | { view: 'map'; focus?: string; lens?: MapLens; bucket?: string; filter?: string; landed?: 'today' }
  | { view: 'bead'; id: string }
  /** `root` is the txid of a General post whose thread of replies is open (docs/protocol.md §14). */
  | { view: 'talk'; thread?: string; root?: string; prefill?: string }
  /** The Talk line: a spoken conversation with the Mayor (docs/protocol.md §20). `call` is the txid of the ring he answered (§21). */
  | { view: 'line'; call?: string; about?: TalkAbout }
  | { view: 'search'; q?: string }
  | { view: 'me' }
  /** The saved prompts, each with Run and Edit (src/cockpit/PromptsScreen.tsx). */
  | { view: 'prompts' }
  | { view: 'key' }
  | { view: 'share'; id?: string }
  /** Where a push about a record lands before the app knows its thread: it waits
   * for the message with this txid, then moves to that thread (src/cockpit/NoticeScreen.tsx). */
  | { view: 'notice'; tx: string; cls?: MessageClass }
  /** A push with no record behind it (the watchdog's alarm), carrying what it said. */
  | { view: 'alarm'; title?: string; body?: string; ts?: number };

export type TopView = 'needs' | 'map' | 'talk' | 'search' | 'me';

const CLASSES: MessageClass[] = ['message', 'decision-needed', 'landing', 'alarm'];

const LENSES: MapLens[] = ['board', 'graph', 'list'];

function lens(value: string | null): MapLens | undefined {
  return LENSES.includes(value as MapLens) ? (value as MapLens) : undefined;
}

/** What a Talk button says the line is about (`ak`, `ai`, `an`): all three, or none. */
function aboutOf(params: URLSearchParams): { about?: TalkAbout } {
  const kind = params.get('ak');
  const id = params.get('ai');
  const title = params.get('an');
  if (!kind || !ABOUT_KINDS.includes(kind as TalkAbout['kind']) || !id || title === null) return {};
  return { about: { kind: kind as TalkAbout['kind'], id, title } };
}

function legacy(params: URLSearchParams): Route | undefined {
  switch (params.get('screen')) {
    case 'inbox':
      return { view: 'needs' };
    case 'projects':
      return { view: 'map' };
    case 'project':
      return { view: 'map', focus: params.get('epic') ?? undefined };
    case 'bead': {
      const id = params.get('bead');
      return id ? { view: 'bead', id } : { view: 'map' };
    }
    case 'thread':
      return { view: 'talk', thread: params.get('thread') ?? 'general' };
    case 'threads':
      return { view: 'talk' };
    case 'compose':
      return { view: 'talk', thread: 'general' };
    case 'key':
      return { view: 'key' };
    case 'notifications':
      return { view: 'me' };
    default:
      return undefined;
  }
}

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const old = legacy(params);
  if (old) return old;
  switch (params.get('v')) {
    case 'map':
      return {
        view: 'map',
        focus: params.get('focus') ?? undefined,
        lens: lens(params.get('lens')),
        bucket: params.get('b') ?? undefined,
        filter: params.get('f') ?? undefined,
        landed: params.get('landed') === 'today' ? 'today' : undefined,
      };
    case 'bead': {
      const id = params.get('id');
      return id ? { view: 'bead', id } : { view: 'map' };
    }
    case 'talk':
      return {
        view: 'talk',
        thread: params.get('t') ?? undefined,
        ...(params.get('r') ? { root: params.get('r') as string } : {}),
        ...(params.get('p') ? { prefill: params.get('p') as string } : {}),
      };
    case 'line':
      return { view: 'line', ...(params.get('call') ? { call: params.get('call') as string } : {}), ...aboutOf(params) };
    case 'search':
      return { view: 'search', q: params.get('q') ?? undefined };
    case 'me':
      return { view: 'me' };
    case 'prompts':
      return { view: 'prompts' };
    case 'key':
      return { view: 'key' };
    case 'share':
      return { view: 'share', id: params.get('s') ?? undefined };
    case 'notice': {
      const tx = params.get('tx');
      if (!tx) return { view: 'needs' };
      const cls = params.get('c');
      return { view: 'notice', tx, cls: CLASSES.includes(cls as MessageClass) ? (cls as MessageClass) : undefined };
    }
    case 'alarm': {
      const ts = Number(params.get('ts'));
      return { view: 'alarm', title: params.get('title') ?? undefined, body: params.get('body') ?? undefined, ts: Number.isFinite(ts) && ts > 0 ? ts : undefined };
    }
    case 'needs': {
      const who = params.get('who');
      return who === 'mayor' || who === 'factory' ? { view: 'needs', who } : { view: 'needs' };
    }
    default:
      return { view: 'needs' };
  }
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams();
  params.set('v', route.view);
  switch (route.view) {
    case 'needs':
      if (route.who && route.who !== 'you') params.set('who', route.who);
      break;
    case 'map':
      if (route.focus) params.set('focus', route.focus);
      if (route.lens) params.set('lens', route.lens);
      if (route.bucket) params.set('b', route.bucket);
      if (route.filter) params.set('f', route.filter);
      if (route.landed) params.set('landed', route.landed);
      break;
    case 'bead':
      params.set('id', route.id);
      break;
    case 'talk':
      if (route.thread) params.set('t', route.thread);
      if (route.thread && route.root) params.set('r', route.root);
      if (route.thread && route.prefill) params.set('p', route.prefill);
      break;
    case 'line':
      if (route.call) params.set('call', route.call);
      if (route.about) {
        params.set('ak', route.about.kind);
        params.set('ai', route.about.id);
        params.set('an', route.about.title);
      }
      break;
    case 'search':
      if (route.q) params.set('q', route.q);
      break;
    case 'share':
      if (route.id) params.set('s', route.id);
      break;
    case 'notice':
      params.set('tx', route.tx);
      if (route.cls) params.set('c', route.cls);
      break;
    case 'alarm':
      if (route.title) params.set('title', route.title);
      if (route.body) params.set('body', route.body);
      if (route.ts) params.set('ts', String(route.ts));
      break;
  }
  return `?${params.toString()}`;
}

export function topViewOf(route: Route): TopView {
  switch (route.view) {
    case 'bead':
    case 'map':
      return 'map';
    case 'talk':
    case 'line':
      return 'talk';
    case 'search':
      return 'search';
    case 'me':
    case 'prompts':
    case 'key':
      return 'me';
    default:
      return 'needs';
  }
}

/** Whether the route is a step down from a tab's own top (a bead, a thread, an
 * epic): the phone layout shows Back there. */
export function isDeep(route: Route): boolean {
  return (
    route.view === 'bead' ||
    route.view === 'share' ||
    route.view === 'notice' ||
    route.view === 'alarm' ||
    route.view === 'key' ||
    route.view === 'prompts' ||
    route.view === 'line' ||
    (route.view === 'talk' && route.thread !== undefined) ||
    (route.view === 'map' && route.focus !== undefined)
  );
}

export const href = formatRoute;

export function beadHref(id: string): string {
  return formatRoute({ view: 'bead', id });
}

export function threadHrefFor(key: string | undefined): string {
  return formatRoute({ view: 'talk', thread: key ?? 'general' });
}
