import { describe, it, expect } from 'vitest';
import {
  createMnemonic,
  isValidMnemonic,
  deriveMasterKey,
  deriveAesKeyFromPrf,
  deriveAesKeyFromPhrase,
  wrapKey,
  unwrapKey,
} from '../../src/services/vault';

describe('vault', () => {
  it('generates a valid 12-word mnemonic', () => {
    const mnemonic = createMnemonic();
    expect(mnemonic.trim().split(/\s+/)).toHaveLength(12);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('rejects a mnemonic with a bad checksum', () => {
    expect(isValidMnemonic('abandon '.repeat(11) + 'about wrong')).toBe(false);
  });

  it('derives the same master key from the same mnemonic every time', async () => {
    const mnemonic = createMnemonic();
    const key1 = await deriveMasterKey(mnemonic);
    const key2 = await deriveMasterKey(mnemonic);
    expect(key1).toHaveLength(32);
    expect(key1).toEqual(key2);
  });

  it('derives different master keys from different mnemonics', async () => {
    const key1 = await deriveMasterKey(createMnemonic());
    const key2 = await deriveMasterKey(createMnemonic());
    expect(key1).not.toEqual(key2);
  });

  it('round-trips a key wrapped with a PRF-derived AES key', async () => {
    const key = await deriveMasterKey(createMnemonic());
    const prfSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const aesKey = await deriveAesKeyFromPrf(prfSecret);
    const wrapped = await wrapKey(key, aesKey);
    const unwrapped = await unwrapKey(wrapped, aesKey);
    expect(unwrapped).toEqual(key);
  });

  it('fails to unwrap a PRF-wrapped key with the wrong PRF secret', async () => {
    const key = await deriveMasterKey(createMnemonic());
    const aesKey = await deriveAesKeyFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const wrapped = await wrapKey(key, aesKey);
    const wrongAesKey = await deriveAesKeyFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer);
    await expect(unwrapKey(wrapped, wrongAesKey)).rejects.toThrow();
  });

  it('round-trips a key wrapped with a phrase-derived AES key', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
    const wrapped = await wrapKey(key, aesKey);
    const unwrapped = await unwrapKey(wrapped, aesKey);
    expect(unwrapped).toEqual(key);
  });

  it('fails to unwrap a phrase-wrapped key with the wrong phrase', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
    const wrapped = await wrapKey(key, aesKey);
    const wrongAesKey = await deriveAesKeyFromPhrase(createMnemonic(), salt);
    await expect(unwrapKey(wrapped, wrongAesKey)).rejects.toThrow();
  });
});
