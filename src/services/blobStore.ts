// src/services/blobStore.ts — where an attachment's bytes are kept between page loads,
// by the blob's hash (mw-gq6.284). It holds exactly what the server sent: the ciphertext
// of GET /api/blobs/{hash}, never decrypted bytes. The real adapter is the Cache API,
// falling back to memory where the browser has none.
export interface BlobStore {
  get(hash: string): Promise<Uint8Array | undefined>;
  put(hash: string, bytes: Uint8Array): Promise<void>;
}

export function memoryBlobStore(): BlobStore {
  const entries = new Map<string, Uint8Array>();
  return {
    get: async (hash) => entries.get(hash),
    put: async (hash, bytes) => void entries.set(hash, new Uint8Array(bytes)),
  };
}

const CACHE_NAME = 'postern-blobs-v1';

/** A synthetic same-origin URL per hash: the Cache API keys on requests. */
function keyOf(hash: string): string {
  return `${location.origin}/__blobs/${hash}`;
}

export function cacheApiBlobStore(): BlobStore {
  const memory = memoryBlobStore();
  return {
    async get(hash) {
      if (typeof caches === 'undefined') return memory.get(hash);
      const cache = await caches.open(CACHE_NAME);
      const found = await cache.match(keyOf(hash));
      return found ? new Uint8Array(await found.arrayBuffer()) : undefined;
    },
    async put(hash, bytes) {
      if (typeof caches === 'undefined') return memory.put(hash, bytes);
      const cache = await caches.open(CACHE_NAME);
      await cache.put(keyOf(hash), new Response(new Uint8Array(bytes)));
    },
  };
}
