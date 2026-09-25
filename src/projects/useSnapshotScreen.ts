// src/projects/useSnapshotScreen.ts — the vault-unlock and snapshot-fetch state
// shared by the Projects, Project and bead screens (each is its own page load,
// per src/App.tsx's query-string routing, so each unlocks independently — the
// same pattern src/inbox/Inbox.tsx uses for messages).
import { useCallback, useEffect, useState } from 'react';
import { Utils } from '@bsv/sdk';
import { vaultRepo } from '../data/repositories';
import type { VaultRow } from '../data/db';
import { getPrfSecret, describeUnlockError } from '../services/webauthnPrf';
import { deriveAesKeyFromPhrase, deriveAesKeyFromPrf, findInvalidWords, unwrapKey } from '../services/vault';
import { fetchSnapshot } from '../services/snapshot';
import type { Snapshot } from '../services/questions';
import { hideAnsweredNeedsYou } from './answeredNeedsYou';

export type VaultState =
  | { name: 'loading' }
  | { name: 'no-key' }
  | { name: 'locked'; vault: VaultRow }
  | { name: 'ready'; key: Uint8Array };

export interface SnapshotState {
  snapshot?: Snapshot;
  offline: boolean;
  error?: string;
}

function describeInvalidWords(words: string[]): string {
  const quoted = words.map((word) => `'${word}'`).join(', ');
  return words.length === 1
    ? `${quoted} is not a word of the recovery list.`
    : `${quoted} are not words of the recovery list.`;
}

function keyToHex(key: Uint8Array): string {
  return Utils.toHex(Array.from(key));
}

export function useSnapshotScreen() {
  const [vaultState, setVaultState] = useState<VaultState>({ name: 'loading' });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [phraseInput, setPhraseInput] = useState('');
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({ offline: false });

  useEffect(() => {
    void vaultRepo.get().then((vault) => setVaultState(vault ? { name: 'locked', vault } : { name: 'no-key' }));
  }, []);

  const loadSnapshot = useCallback((key: Uint8Array) => {
    fetchSnapshot({ unlockedKeyHex: keyToHex(key) })
      .then(async (result) => ({ ...result, snapshot: await hideAnsweredNeedsYou(result.snapshot) }))
      .then((result) => setSnapshotState({ snapshot: result.snapshot, offline: result.offline, error: result.error }))
      .catch((err: unknown) => setSnapshotState({ offline: true, error: (err as Error).message }));
  }, []);

  async function handleUnlockWithFingerprint(vault: VaultRow): Promise<void> {
    setUnlockError(null);
    try {
      if (!vault.credentialId) throw new Error('No passkey is registered for this key.');
      const prfSecret = await getPrfSecret(vault.credentialId);
      if (!prfSecret) throw new Error('The passkey did not return a PRF secret.');
      const aesKey = await deriveAesKeyFromPrf(prfSecret);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setVaultState({ name: 'ready', key });
      loadSnapshot(key);
    } catch (err) {
      setUnlockError(describeUnlockError(err));
    }
  }

  async function handleUnlockWithPhrase(vault: VaultRow): Promise<void> {
    setUnlockError(null);
    const invalidWords = findInvalidWords(phraseInput);
    if (invalidWords.length > 0) {
      setUnlockError(describeInvalidWords(invalidWords));
      return;
    }
    try {
      if (!vault.salt) throw new Error('No recovery salt is stored for this key.');
      const aesKey = await deriveAesKeyFromPhrase(phraseInput, vault.salt);
      const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, aesKey);
      setPhraseInput('');
      setVaultState({ name: 'ready', key });
      loadSnapshot(key);
    } catch {
      setUnlockError('That recovery phrase did not unlock the key.');
    }
  }

  const refresh = useCallback(() => {
    if (vaultState.name === 'ready') loadSnapshot(vaultState.key);
  }, [vaultState, loadSnapshot]);

  return {
    vaultState,
    unlockError,
    phraseInput,
    setPhraseInput,
    handleUnlockWithFingerprint,
    handleUnlockWithPhrase,
    snapshotState,
    refresh,
  };
}
