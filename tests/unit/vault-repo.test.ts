import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';

describe('vaultRepo', () => {
  beforeEach(async () => {
    await db.vault.clear();
  });

  it('returns undefined when no key has been wrapped yet', async () => {
    expect(await vaultRepo.get()).toBeUndefined();
  });

  it('round-trips a PRF-wrapped vault row', async () => {
    await vaultRepo.save({
      mode: 'prf',
      ciphertext: new Uint8Array([1, 2, 3]).buffer,
      iv: new Uint8Array([4, 5, 6]),
      credentialId: new Uint8Array([7, 8]).buffer,
      publicKeyHex: '02'.padEnd(66, '1'),
    });

    const row = await vaultRepo.get();
    expect(row?.mode).toBe('prf');
    expect(new Uint8Array(row!.ciphertext)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('round-trips a phrase-wrapped vault row', async () => {
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([9]).buffer,
      iv: new Uint8Array([1]),
      salt: new Uint8Array([2, 3]),
      publicKeyHex: '02'.padEnd(66, '1'),
    });

    const row = await vaultRepo.get();
    expect(row?.mode).toBe('phrase');
    expect(row?.credentialId).toBeUndefined();
  });

  it('clears the stored vault row', async () => {
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array([1]),
      salt: new Uint8Array([1]),
      publicKeyHex: '02'.padEnd(66, '1'),
    });
    await vaultRepo.clear();
    expect(await vaultRepo.get()).toBeUndefined();
  });
});
