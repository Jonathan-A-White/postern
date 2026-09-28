// src/services/blobs.ts — reads an attachment back (docs/protocol.md §8 and §14):
// downloads its ciphertext from GET /api/blobs/{hash}, checks the bytes are the
// ones announced (their sha256 is the hash), and decrypts them — as the
// recipient for what the Mayor sent, as the sender for what this phone sent.
// Each decrypted file becomes an object URL, kept for the life of the page.
import { PrivateKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';
import { apiFetch } from './apiAuth';
import { decryptBytesAsSender } from './messages';
import type { Attachment } from './threads';

const urls = new Map<string, string>();

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

/** Resolves an object URL for the decrypted attachment. */
export async function openAttachment(attachment: Attachment, options: OpenAttachmentOptions): Promise<string> {
  const cached = urls.get(attachment.hash);
  if (cached) return cached;
  const response = await apiFetch(`/blobs/${attachment.hash}`, undefined, {
    unlockedKey: options.key,
    apiBase: options.apiBase,
    fetchImpl: options.fetchImpl,
  });
  if (response.status === 404) throw new Error('This file has expired from the backend (kept 30 days).');
  if (!response.ok) throw new Error(`The backend answered ${response.status} for this file.`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(ciphertext)) !== attachment.hash) throw new Error('This file does not match what was sent; refused.');
  const keyHex = Utils.toHex(Array.from(options.key));
  const plain =
    options.direction === 'sent'
      ? decryptBytesAsSender(Array.from(ciphertext), keyHex)
      : EncryptedMessage.decrypt(Array.from(ciphertext), PrivateKey.fromHex(keyHex));
  const url = URL.createObjectURL(new Blob([new Uint8Array(plain)], { type: attachment.mime }));
  urls.set(attachment.hash, url);
  return url;
}
