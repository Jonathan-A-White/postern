// src/projects/VaultGate.tsx — the loading/no-key/locked markup every
// snapshot-backed screen shows before it has an unlocked key, factored out of
// ProjectsScreen/ProjectScreen/BeadScreen since all three need it verbatim
// (src/inbox/Inbox.tsx has its own copy, predating this hook).
import type { VaultRow } from '../data/db';
import type { VaultState } from './useSnapshotScreen';

export interface VaultGateProps {
  vaultState: VaultState;
  unlockError: string | null;
  phraseInput: string;
  setPhraseInput: (value: string) => void;
  onUnlockWithFingerprint: (vault: VaultRow) => void;
  onUnlockWithPhrase: (vault: VaultRow) => void;
}

export function VaultGate({
  vaultState,
  unlockError,
  phraseInput,
  setPhraseInput,
  onUnlockWithFingerprint,
  onUnlockWithPhrase,
}: VaultGateProps) {
  return (
    <>
      {vaultState.name === 'loading' && <p>Loading…</p>}

      {vaultState.name === 'no-key' && (
        <div className="flex flex-col gap-2">
          <p>No key is set up on this phone yet.</p>
          <a className="text-sm underline" href="?screen=key">
            Set up your key
          </a>
        </div>
      )}

      {unlockError && (
        <p role="alert" className="text-red-400">
          {unlockError}
        </p>
      )}

      {vaultState.name === 'locked' && vaultState.vault.mode === 'prf' && (
        <div className="flex flex-col gap-2">
          <p>The key is locked.</p>
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => onUnlockWithFingerprint(vaultState.vault)}>
            Unlock with your fingerprint
          </button>
        </div>
      )}

      {vaultState.name === 'locked' && vaultState.vault.mode === 'phrase' && (
        <div className="flex flex-col gap-2">
          <p>The key is locked.</p>
          <label htmlFor="recovery-phrase">Recovery phrase</label>
          <textarea id="recovery-phrase" value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)} />
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => onUnlockWithPhrase(vaultState.vault)}>
            Unlock
          </button>
        </div>
      )}
    </>
  );
}
