// src/services/blobs.ts — reads an attachment back (docs/protocol.md §8 and §14):
// downloads its ciphertext from GET /api/blobs/{hash}, checks the bytes are the
// ones announced (their sha256 is the hash), and decrypts them — as the
// recipient for what the Mayor sent, as the sender for what this phone sent.
// Each decrypted file becomes an object URL, kept for the life of the page; the
// ciphertext the server sent is kept by hash in a persistent store (blobStore.ts), so
// a later page load reads it from there instead of downloading it again (mw-gq6.284).
// A blob already loading is joined, and at most MAX_BLOB_FETCHES go to the backend at
// once: a queued request takes its challenge and signs it only when it goes out.
import { PrivateKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { apiFetch } from './apiAuth';
import { cacheApiBlobStore, type BlobStore } from './blobStore';
import { createLimiter } from './limiter';
import { decryptBytesAsSender } from './messages';
import type { Attachment } from './threads';

/** Blobs asked of the backend at once. */
export const MAX_BLOB_FETCHES = 4;

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string>>();
const limiter = createLimiter(MAX_BLOB_FETCHES);
let store: BlobStore | undefined;

/** Swaps the persistent store (a fake in tests). */
export function setBlobStore(next: BlobStore): void {
  store = next;
}

/** Forgets what this page load knows (object URLs, loads in flight), as a reload does; the store stays. */
export function resetBlobSession(): void {
  urls.clear();
  loading.clear();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

export interface OpenAttachmentOptions {
  key: Uint8Array;
  direction: 'sent' | 'received';
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** The ciphertext of `hash` from the store, or undefined when it is missing, unreadable or not the announced bytes. */
async function stored(hash: string): Promise<Uint8Array | undefined> {
  try {
    const bytes = await (store ??= cacheApiBlobStore()).get(hash);
    return bytes && (await sha256Hex(new Uint8Array(bytes))) === hash ? new Uint8Array(bytes) : undefined;
  } catch {
    return undefined;
  }
}

async function download(attachment: Attachment, options: OpenAttachmentOptions): Promise<Uint8Array> {
  const response = await limiter.run(async () => {
    const answered = await apiFetch(`/blobs/${attachment.hash}`, undefined, {
      unlockedKey: options.key,
      apiBase: options.apiBase,
      fetchImpl: options.fetchImpl,
    });
    if (answered.status === 404) throw new Error('This file has expired from the backend (kept 30 days).');
    if (!answered.ok) throw new Error(`The backend answered ${answered.status} for this file.`);
    return new Uint8Array(await answered.arrayBuffer());
  });
  if ((await sha256Hex(response)) !== attachment.hash) throw new Error('This file does not match what was sent; refused.');
  // What the server sent, as it sent it: never the decrypted bytes. A store that fails does not stop the file opening.
  await (store ??= cacheApiBlobStore()).put(attachment.hash, response).catch(() => undefined);
  return response;
}

async function load(attachment: Attachment, options: OpenAttachmentOptions): Promise<string> {
  const ciphertext = (await stored(attachment.hash)) ?? (await download(attachment, options));
  const keyHex = Utils.toHex(Array.from(options.key));
  const plain =
    options.direction === 'sent'
      ? decryptBytesAsSender(Array.from(ciphertext), keyHex)
      : EncryptedMessage.decrypt(Array.from(ciphertext), PrivateKey.fromHex(keyHex));
  const url = URL.createObjectURL(new Blob([new Uint8Array(plain)], { type: attachment.mime }));
  urls.set(attachment.hash, url);
  return url;
}

/** Resolves an object URL for the decrypted attachment. A second ask for a file already loading joins that load. */
export function openAttachment(attachment: Attachment, options: OpenAttachmentOptions): Promise<string> {
  const cached = urls.get(attachment.hash);
  if (cached) return Promise.resolve(cached);
  const running = loading.get(attachment.hash);
  if (running) return running;
  const started = load(attachment, options).finally(() => loading.delete(attachment.hash));
  loading.set(attachment.hash, started);
  return started;
}
