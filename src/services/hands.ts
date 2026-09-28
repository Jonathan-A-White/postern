// src/services/hands.ts — his approval of a hands step (docs/protocol.md §17).
// The app checks the text it shows hashes to the hash the Mayor's host gave,
// asks for his fingerprint again (a fresh passkey assertion, however long ago
// the day's unlock was), and only then signs the approval with his key. The
// factory's host runs nothing his signature does not name.
import { PrivateKey, Utils } from '@bsv/sdk';
import { approvalMessage, stepSha256, type HandsStep } from '../model/hands';
import { vaultRepo } from '../data/repositories';
import { getPrfSecret } from './webauthnPrf';
import type { GovernorAction } from '../model/conversation';

export class StepChangedError extends Error {
  constructor() {
    super('This step does not match its fingerprint; it was not approved. Refresh and look again.');
    this.name = 'StepChangedError';
  }
}

/** A fresh fingerprint, for a passkey-wrapped key. A phrase-wrapped key has no
 * passkey to ask; the confirmation he just tapped is its step-up. */
export async function stepUp(): Promise<'passkey' | 'confirmed'> {
  const vault = await vaultRepo.get();
  if (vault?.mode === 'prf' && vault.credentialId) {
    const secret = await getPrfSecret(vault.credentialId);
    if (!secret) throw new Error('The passkey did not confirm it was you.');
    return 'passkey';
  }
  return 'confirmed';
}

/** The §13 `run` action for `step` on `bead`, signed by `key` at `now`. */
export async function buildApproval(bead: string, step: HandsStep, key: Uint8Array, now: number = Date.now()): Promise<GovernorAction> {
  if ((await stepSha256(bead, step)) !== step.sha256) throw new StepChangedError();
  const approvedAt = Math.floor(now / 1000);
  const signer = PrivateKey.fromHex(Utils.toHex(Array.from(key)));
  const sig = signer.sign(approvalMessage(step.sha256, approvedAt)).toDER('hex') as string;
  return { action: 'run', bead, step: step.id, sha256: step.sha256, approved_at: approvedAt, sig };
}
