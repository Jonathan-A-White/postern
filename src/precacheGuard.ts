// src/precacheGuard.ts — mw-j0f2d.41: the service worker's guard over its precached scripts and
// stylesheets. A site half-deployed once let nginx answer a missing /assets/index-X.css with the
// app page (200 text/html); the worker precached that, a hashed URL is never fetched again, and
// X-Content-Type-Options: nosniff made the browser refuse it as CSS for good. So an asset is kept
// and served only if its Content-Type fits its extension; one that does not is deleted and fetched
// again from the network.

/** What a response must say it is for a URL path, or undefined when the path is not a script or stylesheet. */
function expectedType(pathname: string): RegExp | undefined {
  if (pathname.endsWith('.css')) return /^text\/css\b/i;
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return /^(text|application)\/(x-)?(javascript|ecmascript)\b/i;
  return undefined;
}

/** True for a path the guard watches: a .css or .js file. */
export function isGuardedAsset(pathname: string): boolean {
  return expectedType(pathname) !== undefined;
}

/** True when `response` is a fit answer for `url` (a path the guard does not watch always fits). */
export function typeFits(url: string, response: Response): boolean {
  const expected = expectedType(new URL(url).pathname);
  return expected === undefined || expected.test(response.headers.get('Content-Type') ?? '');
}

async function precacheCaches(storage: CacheStorage): Promise<Cache[]> {
  const names = (await storage.keys()).filter((name) => name.startsWith('workbox-precache'));
  return Promise.all(names.map((name) => storage.open(name)));
}

/** Fetches `url` again and keeps the answer only when it fits. */
async function refetch(cache: Cache, url: string): Promise<Response | undefined> {
  const fresh = await fetch(url, { cache: 'reload' });
  if (!fresh.ok || !typeFits(url, fresh)) return undefined;
  await cache.put(url, fresh.clone());
  return fresh;
}

/** On activate: every precached script or stylesheet of the wrong type is deleted and fetched again. */
export async function healPrecache(storage: CacheStorage): Promise<void> {
  for (const cache of await precacheCaches(storage)) {
    for (const key of await cache.keys()) {
      if (!isGuardedAsset(new URL(key.url).pathname)) continue;
      const stored = await cache.match(key);
      if (!stored || typeFits(key.url, stored)) continue;
      await cache.delete(key);
      try {
        await refetch(cache, key.url);
      } catch {
        // offline: the next activate, or the network answer on the next request, puts it right
      }
    }
  }
}

/** The answer for a request for a script or stylesheet: the precached one if its type fits, else the network's. */
export async function serveAsset(request: Request, storage: CacheStorage): Promise<Response> {
  for (const cache of await precacheCaches(storage)) {
    const stored = await cache.match(request, { ignoreSearch: true });
    if (!stored) continue;
    if (typeFits(request.url, stored)) return stored;
    await cache.delete(request, { ignoreSearch: true });
  }
  return fetch(request);
}
