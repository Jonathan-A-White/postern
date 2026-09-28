// src/nav/route.ts — every place in the cockpit as a URL, so Back, a notification
// tap and a link in a comment all land exactly there. Still a query string (the
// app is served as static files by nginx, with no rewrite rules): `?v=` names
// the view and the rest of the query says where in it. Links the old screens
// used (`?screen=…`, from notifications already delivered) are read too.

export type MapLens = 'board' | 'graph' | 'list';

export type Route =
  | { view: 'needs' }
  | { view: 'map'; focus?: string; lens?: MapLens; bucket?: string; filter?: string }
  | { view: 'bead'; id: string }
  | { view: 'talk'; thread?: string }
  | { view: 'search'; q?: string }
  | { view: 'me' }
  | { view: 'key' }
  | { view: 'share'; id?: string };

export type TopView = 'needs' | 'map' | 'talk' | 'search' | 'me';

const LENSES: MapLens[] = ['board', 'graph', 'list'];

function lens(value: string | null): MapLens | undefined {
  return LENSES.includes(value as MapLens) ? (value as MapLens) : undefined;
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
      };
    case 'bead': {
      const id = params.get('id');
      return id ? { view: 'bead', id } : { view: 'map' };
    }
    case 'talk':
      return { view: 'talk', thread: params.get('t') ?? undefined };
    case 'search':
      return { view: 'search', q: params.get('q') ?? undefined };
    case 'me':
      return { view: 'me' };
    case 'key':
      return { view: 'key' };
    case 'share':
      return { view: 'share', id: params.get('s') ?? undefined };
    default:
      return { view: 'needs' };
  }
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams();
  params.set('v', route.view);
  switch (route.view) {
    case 'map':
      if (route.focus) params.set('focus', route.focus);
      if (route.lens) params.set('lens', route.lens);
      if (route.bucket) params.set('b', route.bucket);
      if (route.filter) params.set('f', route.filter);
      break;
    case 'bead':
      params.set('id', route.id);
      break;
    case 'talk':
      if (route.thread) params.set('t', route.thread);
      break;
    case 'search':
      if (route.q) params.set('q', route.q);
      break;
    case 'share':
      if (route.id) params.set('s', route.id);
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
      return 'talk';
    case 'search':
      return 'search';
    case 'me':
    case 'key':
      return 'me';
    default:
      return 'needs';
  }
}

/** Whether the route is a step down from a tab's own top (a bead, a thread, an
 * epic): the phone layout shows Back there and hides the tab bar. */
export function isDeep(route: Route): boolean {
  return (
    route.view === 'bead' ||
    route.view === 'share' ||
    route.view === 'key' ||
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
