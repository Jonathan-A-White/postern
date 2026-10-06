// tests/unit/blob-store.test.ts — mw-gq6.284: the persistent blob store keeps what the
// server sent (ciphertext) by hash and nothing else; the Cache API adapter and its memory
// fallback; a store entry that is not the announced bytes is not believed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAttachment, resetBlobSession, setBlobStore } from '../../src/services/blobs';
import { cacheApiBlobStore, memoryBlobStore } from '../../src/services/blobStore';
import { FakeBlobStore } from '../support/fake-blob-store';
import { FakeBlobsBackend, PHONE_KEY, sentFile } from '../support/fake-blobs-backend';

describe('the persistent blob store', () => {
  let backend: FakeBlobsBackend;
  let store: FakeBlobStore;
  beforeEach(() => {
    backend = new FakeBlobsBackend();
    store = new FakeBlobStore();
    setBlobStore(store);
    resetBlobSession();
    URL.createObjectURL = () => 'blob:image';
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = (file: Awaited<ReturnType<typeof sentFile>>) => openAttachment(file, { key: PHONE_KEY, direction: 'sent', fetchImpl: backend.fetch });

  it('holds only the ciphertext the server sent, never the decrypted bytes', async () => {
    const file = await sentFile(1);
    backend.add(file);
    await open(file);
    expect([...store.entries.keys()]).toEqual([file.hash]);
    expect(Array.from(store.entries.get(file.hash)!)).toEqual(Array.from(file.ciphertext));
    expect(Array.from(store.entries.get(file.hash)!)).not.toEqual(Array.from(file.plain));
  });

  it('does not keep a file that does not match its hash', async () => {
    const file = await sentFile(2);
    backend.add({ ...file, ciphertext: new Uint8Array([1, 2, 3]) });
    await expect(open(file)).rejects.toThrow(/does not match/);
    expect(store.entries.size).toBe(0);
  });

  it('ignores a stored entry that is not the announced bytes and fetches again', async () => {
    const file = await sentFile(3);
    backend.add(file);
    store.entries.set(file.hash, new Uint8Array([9, 9, 9]));
    await open(file);
    expect(backend.blobRequests).toEqual([file.hash]);
    expect(Array.from(store.entries.get(file.hash)!)).toEqual(Array.from(file.ciphertext));
  });

  it('a load that failed is tried afresh the next time, not remembered as in flight', async () => {
    const file = await sentFile(4);
    await expect(open(file)).rejects.toThrow(/expired/);
    backend.add(file);
    await expect(open(file)).resolves.toBe('blob:image');
  });

  it('a store that cannot be written does not stop the file opening', async () => {
    const file = await sentFile(5);
    backend.add(file);
    setBlobStore({ get: async () => undefined, put: async () => Promise.reject(new Error('quota')) });
    await expect(open(file)).resolves.toBe('blob:image');
  });
});

describe('the Cache API adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeCaches(): CacheStorage {
    const entries = new Map<string, Response>();
    const cache = {
      match: async (request: string) => entries.get(request)?.clone(),
      put: async (request: string, response: Response) => void entries.set(request, response),
    };
    return { open: async () => cache } as unknown as CacheStorage;
  }

  it('keeps bytes by hash across adapters that share the one cache', async () => {
    vi.stubGlobal('caches', fakeCaches());
    await cacheApiBlobStore().put('aa', new Uint8Array([1, 2, 3]));
    expect(Array.from((await cacheApiBlobStore().get('aa'))!)).toEqual([1, 2, 3]);
    expect(await cacheApiBlobStore().get('bb')).toBeUndefined();
  });

  it('falls back to memory where the Cache API is missing', async () => {
    vi.stubGlobal('caches', undefined);
    const store = cacheApiBlobStore();
    await store.put('aa', new Uint8Array([4, 5]));
    expect(Array.from((await store.get('aa'))!)).toEqual([4, 5]);
  });

  it('the memory store hands back what it was given', async () => {
    const store = memoryBlobStore();
    expect(await store.get('x')).toBeUndefined();
    await store.put('x', new Uint8Array([7]));
    expect(Array.from((await store.get('x'))!)).toEqual([7]);
  });
});
