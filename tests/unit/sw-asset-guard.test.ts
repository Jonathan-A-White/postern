// A precached asset that is not what its extension says (mw-j0f2d.41): the site was half-deployed,
// nginx answered a missing /assets/index-X.css with the app page (200 text/html), the service worker
// precached that, and nosniff made the phone refuse it as a stylesheet, for good. The worker, in
// tests/support/sw-harness.ts's real src/sw.ts, deletes such entries on activate and never serves one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorker, type WorkerHarness } from '../support/sw-harness';

const ORIGIN = window.location.origin;
const CACHE_NAME = `workbox-precache-v2-${ORIGIN}/`;

/** A CacheStorage with one cache, keyed by URL, matching with ignoreSearch like workbox's precache lookups. */
function fakeCaches(entries: Record<string, Response>) {
  const store = new Map(Object.entries(entries));
  const cache = {
    keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
    match: vi.fn(async (request: Request | string) => {
      const url = new URL(typeof request === 'string' ? request : request.url);
      for (const [key, response] of store) {
        const stored = new URL(key);
        if (stored.origin + stored.pathname === url.origin + url.pathname) return response.clone();
      }
      return undefined;
    }),
    delete: vi.fn(async (request: Request | string) => store.delete(typeof request === 'string' ? request : request.url)),
    put: vi.fn(async (request: Request | string, response: Response) => void store.set(typeof request === 'string' ? request : request.url, response)),
  };
  return {
    store,
    cache,
    storage: { keys: async () => [CACHE_NAME, 'runtime-other'], open: vi.fn(async () => cache) },
  };
}

const html = () => new Response('<!doctype html><title>Postern</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const css = () => new Response('body{color:#eee}', { headers: { 'Content-Type': 'text/css' } });
const js = () => new Response('export {}', { headers: { 'Content-Type': 'text/javascript' } });

let worker: WorkerHarness;

beforeEach(async () => {
  worker = await loadWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the worker on activate', () => {
  it('deletes a precached .css that is text/html and fetches it from the network again', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/assets/x.css`]: html() });
    vi.stubGlobal('caches', fake.storage);
    const fetchImpl = vi.fn(async () => css());
    vi.stubGlobal('fetch', fetchImpl);

    await worker.activate();

    expect(fake.cache.delete).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Request((fetchImpl.mock.calls[0] as unknown as [Request | string])[0]).url).toBe(`${ORIGIN}/assets/x.css`);
    const kept = fake.store.get(`${ORIGIN}/assets/x.css`);
    expect(kept?.headers.get('Content-Type')).toBe('text/css');
  });

  it('keeps a precached .css that is text/css, and a .js that is javascript, and fetches nothing', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/assets/x.css`]: css(), [`${ORIGIN}/assets/y.js`]: js() });
    vi.stubGlobal('caches', fake.storage);
    const fetchImpl = vi.fn(async () => css());
    vi.stubGlobal('fetch', fetchImpl);

    await worker.activate();

    expect(fake.cache.delete).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fake.store.size).toBe(2);
  });

  it('leaves an entry out when the network answers it with the wrong type again, rather than caching the bad answer', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/assets/x.css`]: html() });
    vi.stubGlobal('caches', fake.storage);
    vi.stubGlobal('fetch', vi.fn(async () => html()));

    await worker.activate();

    expect(fake.store.has(`${ORIGIN}/assets/x.css`)).toBe(false);
  });

  it('does not touch the app page, which is text/html by right', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/index.html`]: html() });
    vi.stubGlobal('caches', fake.storage);
    vi.stubGlobal('fetch', vi.fn());

    await worker.activate();

    expect(fake.cache.delete).not.toHaveBeenCalled();
  });
});

describe('the worker answering a .css or .js request', () => {
  it('goes to the network when the cached response has the wrong type', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/assets/x.css`]: html(), [`${ORIGIN}/assets/y.js`]: html() });
    vi.stubGlobal('caches', fake.storage);
    const fetchImpl = vi.fn(async () => css());
    vi.stubGlobal('fetch', fetchImpl);

    const answer = await worker.fetch(`${ORIGIN}/assets/x.css`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(answer?.headers.get('Content-Type')).toBe('text/css');

    fetchImpl.mockClear();
    fetchImpl.mockImplementation(async () => js());
    const script = await worker.fetch(`${ORIGIN}/assets/y.js`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(script?.headers.get('Content-Type')).toBe('text/javascript');
  });

  it('serves the cached response when its type fits, without the network', async () => {
    const fake = fakeCaches({ [`${ORIGIN}/assets/x.css`]: css(), [`${ORIGIN}/assets/y.js`]: js() });
    vi.stubGlobal('caches', fake.storage);
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    expect((await worker.fetch(`${ORIGIN}/assets/x.css`))?.headers.get('Content-Type')).toBe('text/css');
    expect((await worker.fetch(`${ORIGIN}/assets/y.js`))?.headers.get('Content-Type')).toBe('text/javascript');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers a .css the precache does not hold from the network', async () => {
    const fake = fakeCaches({});
    vi.stubGlobal('caches', fake.storage);
    const fetchImpl = vi.fn(async () => css());
    vi.stubGlobal('fetch', fetchImpl);

    expect((await worker.fetch(`${ORIGIN}/assets/new.css`))?.headers.get('Content-Type')).toBe('text/css');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not answer a page, an API call or another origin\'s asset', async () => {
    vi.stubGlobal('caches', fakeCaches({}).storage);
    vi.stubGlobal('fetch', vi.fn());
    expect(await worker.fetch(`${ORIGIN}/?v=needs`)).toBeUndefined();
    expect(await worker.fetch(`${ORIGIN}/api/view`)).toBeUndefined();
    expect(await worker.fetch('https://elsewhere.example/assets/x.css')).toBeUndefined();
  });
});
