// src/projects/BeadScreen.tsx — a tapped row's brief: title, state badge, and,
// for a Needs you question, the Question screen (mw-tfne4.5): its text, recommended
// answer, option buttons and a free-text box, resolved by bead id against an
// already-synced decision-needed message or, failing that, the snapshot's own
// needs_you fields (src/projects/questionBody.ts).
import { useEffect, useState } from 'react';
import { getMayorPublicKey } from '../services/messages';
import type { QuestionBody } from '../services/questions';
import { QuestionScreen } from './QuestionScreen';
import { resolveQuestionBody } from './questionBody';
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
    handleLock,
    snapshotState,
  } = useSnapshotScreen();

  const epic = snapshotState.snapshot?.epics.find((candidate) => candidate.id === epicId);
  const needsYouItem = kind === 'needs_you' ? epic?.needs_you.find((item) => item.id === beadId) : undefined;
  const landedItem = kind === 'landed' ? epic?.landed.find((item) => item.id === beadId) : undefined;
  const workingItem = kind === 'working' ? epic?.working.find((item) => item.id === beadId) : undefined;
  const item = needsYouItem ?? landedItem ?? workingItem;

  const statusLabel = needsYouItem ? 'Needs you' : landedItem ? 'Landed' : workingItem?.status;

  const [questionBody, setQuestionBody] = useState<QuestionBody | undefined>(undefined);
  const [mayorPublicKey, setMayorPublicKeyState] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!needsYouItem) return;
    void resolveQuestionBody(needsYouItem).then(setQuestionBody);
  }, [needsYouItem]);

  useEffect(() => {
    void getMayorPublicKey().then(setMayorPublicKeyState);
  }, []);

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
        onLock={() => void handleLock()}
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

              {needsYouItem && questionBody && mayorPublicKey && (
                <QuestionScreen
                  question={questionBody}
                  unlockedKey={vaultState.key}
                  recipientPublicKeyHex={mayorPublicKey}
                />
              )}
              {needsYouItem && !mayorPublicKey && (
                <p role="alert" className="text-red-400">
                  No recipient key is set.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
