import { describe, it, expect } from 'vitest';
import {
  createMnemonic,
  isValidMnemonic,
  normalisePhrase,
  findInvalidWords,
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

  it('unlocks a vault wrapped before normalisation was added, since generated phrases are already normalised', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    // The pre-fix derivation: PBKDF2 straight from mnemonic.trim(), no normalisePhrase.
    // 210_000 mirrors PBKDF2_ITERATIONS in src/services/vault.ts at the time of the fix.
    const oldBaseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(mnemonic.trim()),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const oldAesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: 210_000 },
      oldBaseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const wrapped = await wrapKey(key, oldAesKey);

    const newAesKey = await deriveAesKeyFromPhrase(mnemonic, salt);
    const unwrapped = await unwrapKey(wrapped, newAesKey);
    expect(unwrapped).toEqual(key);
  });
});

describe('normalisePhrase', () => {
  it('lowercases, trims, and collapses internal whitespace including newlines', () => {
    expect(normalisePhrase('  Abandon  ABANDON\nabandon ')).toBe('abandon abandon abandon');
  });

  it('applies NFKD normalisation, so a precomposed accent matches a decomposed one', () => {
    expect(normalisePhrase('café')).toBe(normalisePhrase('café'));
  });
});

describe('findInvalidWords', () => {
  it('returns no words when every word is in the recovery wordlist', () => {
    expect(findInvalidWords(createMnemonic())).toEqual([]);
  });

  it('names a word that is not in the recovery wordlist, preserving its original casing', () => {
    const phrase = 'Aple ' + 'abandon '.repeat(10) + 'about';
    expect(findInvalidWords(phrase)).toEqual(['Aple']);
  });
});
