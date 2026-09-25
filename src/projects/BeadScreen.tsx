// src/projects/BeadScreen.tsx — a tapped row's brief: title, state badge, and,
// for a Needs you question, its text (the row's own title), recommended answer
// and options. The reply controls (buttons, free text) come in mw-tfne4.5.
import { useSnapshotScreen } from './useSnapshotScreen';
import { VaultGate } from './VaultGate';

export type BeadKind = 'needs_you' | 'landed' | 'working';

export interface BeadScreenProps {
  epicId: string;
  kind: BeadKind;
  beadId: string;
}

export function BeadScreen({ epicId, kind, beadId }: BeadScreenProps) {
  const {
    vaultState,
    unlockError,
    phraseInput,
    setPhraseInput,
    handleUnlockWithFingerprint,
    handleUnlockWithPhrase,
    snapshotState,
  } = useSnapshotScreen();

  const epic = snapshotState.snapshot?.epics.find((candidate) => candidate.id === epicId);
  const needsYouItem = kind === 'needs_you' ? epic?.needs_you.find((item) => item.id === beadId) : undefined;
  const landedItem = kind === 'landed' ? epic?.landed.find((item) => item.id === beadId) : undefined;
  const workingItem = kind === 'working' ? epic?.working.find((item) => item.id === beadId) : undefined;
  const item = needsYouItem ?? landedItem ?? workingItem;

  const statusLabel = needsYouItem ? 'Needs you' : landedItem ? 'Landed' : workingItem?.status;

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <a className="text-sm underline" href={`?screen=project&epic=${epicId}`}>
        Back
      </a>

      <VaultGate
        vaultState={vaultState}
        unlockError={unlockError}
        phraseInput={phraseInput}
        setPhraseInput={setPhraseInput}
        onUnlockWithFingerprint={(vault) => void handleUnlockWithFingerprint(vault)}
        onUnlockWithPhrase={(vault) => void handleUnlockWithPhrase(vault)}
      />

      {vaultState.name === 'ready' && (
        <div className="flex w-full max-w-md flex-col gap-3">
          {snapshotState.snapshot && !item && <p>Bead not found.</p>}
          {!snapshotState.snapshot && snapshotState.error && (
            <p role="alert" className="text-red-400">
              {snapshotState.error}
            </p>
          )}

          {item && (
            <>
              <h1 className="text-xl font-semibold">{item.title}</h1>
              <p className="text-sm text-slate-400">{statusLabel}</p>

              {needsYouItem && (
                <div className="flex flex-col gap-2">
                  <p>Recommended: {needsYouItem.recommended}</p>
                  <ul className="flex flex-col gap-1">
                    {needsYouItem.options.map((option) => (
                      <li key={option} className="rounded bg-slate-800 px-3 py-2">
                        {option}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
