// src/services/attachments.ts — uploads an encrypted file to POST /api/blobs
// (docs/protocol.md §8): the same challenge-signed fetch every /api call goes
// through (src/services/apiAuth.ts), the ciphertext built by
// src/services/messages.ts's encryptAttachment. The backend answers with the
// ciphertext's own sha256 hash and byte length; this never computes either
// itself.
import { Utils } from '@bsv/sdk';
import { ApiTimeoutError, RefusedError, apiFetch, withTimeout } from './apiAuth';
import { encryptAttachment } from './messages';
import { readErrorMessage } from './errorMessage';
import type { Attachment } from './threads';

/** 8 MB (docs/protocol.md §8's cap; the epic's "8 MB", not "MiB" — the cap this
 * app enforces before any upload is attempted). */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** A file's type as §14 names it: parameters such as `;codecs=opus` dropped, any type
 * carried, and application/octet-stream for a file whose type the phone does not report. */
export function attachmentMime(type: string): string {
  const base = type.split(';')[0].trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';
  return base || 'application/octet-stream';
}

/** A file's base name as §8's `name` carries it: no folders, undefined when nothing is left. */
export function attachmentName(name: string): string | undefined {
  return name.split(/[\\/]/).pop()?.trim() || undefined;
}

export interface UploadAttachmentParams {
  bytes: Uint8Array;
  mime: string;
  /** The file's name, sent as the attachment's `name` (docs/protocol.md §8). */
  name?: string;
  /** The sender's raw 32-byte master key, as unlocked from the vault. */
  senderKey: Uint8Array;
  recipientPublicKeyHex: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Encrypts `bytes` to `recipientPublicKeyHex` and uploads the ciphertext to
 * POST /api/blobs. Resolves with the attachment field a message's plaintext
 * carries (docs/protocol.md §8), or throws a readable error and sends nothing.
 */
export async function uploadAttachment(params: UploadAttachmentParams): Promise<Attachment> {
  const senderPrivateKeyHex = Utils.toHex(Array.from(params.senderKey));
  const ciphertext = encryptAttachment({
    bytes: params.bytes,
    senderPrivateKeyHex,
    recipientPublicKeyHex: params.recipientPublicKeyHex,
  });

  // An upload that times out has not sent the message it was for: nothing has gone.
  const notSent = (err: unknown) => (err instanceof ApiTimeoutError ? new ApiTimeoutError(false) : err);
  const response = await apiFetch(
    '/blobs',
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: ciphertext.buffer as ArrayBuffer },
    { unlockedKey: params.senderKey, apiBase: params.apiBase, fetchImpl: params.fetchImpl },
  ).catch((err: unknown) => {
    throw notSent(err);
  });
  if (!response.ok) {
    throw new RefusedError(await readErrorMessage(response, 'The file upload failed.'), response.status);
  }
  const body = (await withTimeout(response.json(), false).catch((err: unknown) => {
    throw notSent(err);
  })) as { hash?: unknown; size?: unknown };
  if (typeof body.hash !== 'string' || typeof body.size !== 'number') {
    throw new Error('The upload succeeded but returned no hash.');
  }
  const name = params.name === undefined ? undefined : attachmentName(params.name);
  return { hash: body.hash, size: body.size, mime: params.mime, ...(name !== undefined ? { name } : {}) };
}
