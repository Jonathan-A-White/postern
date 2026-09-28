// src/services/documents.ts — the encrypted documents the Mayor's host writes for
// the Governor alone: the live view (docs/protocol.md §11) and a bead's detail
// (§12). Both are base64(BRC-78(gzip(JSON))) from the Mayor's key to his; this
// decrypts, checks the sender is the Mayor he pinned (§15), and inflates.
import { PrivateKey, Utils } from '@bsv/sdk';
import { EncryptedMessage } from 'spell-forge-bsv';

const GZIP_MAGIC = [0x1f, 0x8b];

export function isGzip(bytes: ArrayLike<number>): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot inflate the view (no DecompressionStream).');
  const body = new Response(bytes as BodyInit).body;
  if (!body) throw new Error('Nothing to inflate.');
  const inflated = body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Response(bytes as BodyInit).body;
  if (!body) throw new Error('Nothing to compress.');
  const deflated = body.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(deflated).arrayBuffer());
}

/** The sender key BRC-78 writes in the clear at the head of its ciphertext
 * (docs/protocol.md §2): 4 version bytes, then 33 bytes of sender public key. */
export function brc78Sender(ciphertext: ArrayLike<number>): string {
  return Utils.toHex(Array.from(ciphertext).slice(4, 37));
}

export class WrongSenderError extends Error {
  readonly sender: string;

  constructor(sender: string) {
    super('This was not written by the Mayor you pinned.');
    this.name = 'WrongSenderError';
    this.sender = sender;
  }
}

export interface OpenDocumentOptions {
  /** The Governor's unlocked 32-byte key. */
  key: Uint8Array;
  /** The pinned Mayor key; when given, a document from anyone else is refused. */
  mayorKey?: string;
}

/** Decrypts and inflates one §11/§12 document body, returning its UTF-8 text. */
export async function openDocument(base64: string, options: OpenDocumentOptions): Promise<string> {
  const ciphertext = Utils.toArray(base64.trim(), 'base64');
  if (options.mayorKey) {
    const sender = brc78Sender(ciphertext);
    if (sender !== options.mayorKey) throw new WrongSenderError(sender);
  }
  const recipient = PrivateKey.fromHex(Utils.toHex(Array.from(options.key)));
  const plain = new Uint8Array(EncryptedMessage.decrypt(ciphertext, recipient));
  const bytes = isGzip(plain) ? await gunzip(plain) : plain;
  return new TextDecoder().decode(bytes);
}

/** The inverse, for tests and fixtures: what `mw postern view` writes. */
export async function sealDocument(text: string, senderKeyHex: string, recipientPublicKeyHex: string): Promise<string> {
  const { PublicKey } = await import('@bsv/sdk');
  const zipped = await gzip(new TextEncoder().encode(text));
  const encrypted = EncryptedMessage.encrypt(Array.from(zipped), PrivateKey.fromHex(senderKeyHex), PublicKey.fromString(recipientPublicKeyHex));
  return Utils.toBase64(encrypted);
}
