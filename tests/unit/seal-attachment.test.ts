// tests/unit/seal-attachment.test.ts — mw-8xe671n: a 2 MB photo took 4 s to encrypt on a phone, the page frozen the
// while, because @bsv/sdk's AES-GCM is plain JavaScript in a browser. sealAttachment makes the same BRC-78 bytes
// (docs/protocol.md §8) with the browser's own AES-GCM, so the Mayor's side opens it as it always has.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptedMessage, PrivateKey, SymmetricKey } from '@bsv/sdk';
import { encryptAttachment, sealAttachment } from '../../src/services/messages';

const sender = PrivateKey.fromRandom();
const recipient = PrivateKey.fromRandom();

function bytesOf(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 255;
  return bytes;
}

const params = (bytes: Uint8Array) => ({ bytes, senderPrivateKeyHex: sender.toHex(), recipientPublicKeyHex: recipient.toPublicKey().toString() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sealAttachment (mw-8xe671n)', () => {
  it('makes BRC-78 bytes the recipient opens to the file, laid out as encryptAttachment lays them out', async () => {
    const bytes = bytesOf(70_001);
    const sealed = await sealAttachment(params(bytes));
    const old = encryptAttachment(params(bytes));
    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(sealed.length).toBe(old.length);
    // version, sender's key, recipient's key: the same header
    expect(Array.from(sealed.slice(0, 70))).toEqual(Array.from(old.slice(0, 70)));
    expect(new Uint8Array(EncryptedMessage.decrypt(Array.from(sealed), recipient))).toEqual(bytes);
  });

  it('opens an empty file too', async () => {
    const sealed = await sealAttachment(params(new Uint8Array(0)));
    expect(EncryptedMessage.decrypt(Array.from(sealed), recipient)).toEqual([]);
  });

  it("does not run the file through @bsv/sdk's own AES, which is plain JavaScript in a browser", async () => {
    const slow = vi.spyOn(SymmetricKey.prototype, 'encrypt');
    await sealAttachment(params(bytesOf(4096)));
    expect(slow).not.toHaveBeenCalled();
  });

  it('two seals of one file differ (a fresh key id and IV each time)', async () => {
    const bytes = bytesOf(100);
    const [a, b] = [await sealAttachment(params(bytes)), await sealAttachment(params(bytes))];
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
