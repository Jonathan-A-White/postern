// src/projects/ProjectsScreen.tsx — one row per live epic (mw-f758y.2's
// "Projects screen" paragraph): title, priority, the three group counts, the
// snapshot's age; ordered by priority with any epic holding a question first.
import { formatAge } from '../services/age';
import { threadHref } from '../services/threads';
import { sortEpics } from './grouping';
import { useSnapshotScreen } from './useSnapshotScreen';
import { VaultGate } from './VaultGate';

export function ProjectsScreen() {
  const {
    vaultState,
    unlockError,
    phraseInput,
    setPhraseInput,
    handleUnlockWithFingerprint,
    handleUnlockWithPhrase,
    handleLock,
    snapshotState,
    refresh,
  } = useSnapshotScreen();

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <a className="text-sm underline" href="/">
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
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="flex items-center justify-between">
            {snapshotState.snapshot && (
              <p className="text-xs text-slate-400">
                {snapshotState.offline
                  ? `Offline, as of ${formatAge(snapshotState.snapshot.written_at)}`
                  : formatAge(snapshotState.snapshot.written_at)}
              </p>
            )}
            <button className="rounded bg-slate-700 px-3 py-1 text-sm" onClick={refresh}>
              Refresh
            </button>
          </div>

          {!snapshotState.snapshot && snapshotState.error && (
            <p role="alert" className="text-red-400">
              {snapshotState.error}
            </p>
          )}

          {snapshotState.snapshot && (
            <ul className="flex flex-col gap-2">
              {sortEpics(snapshotState.snapshot.epics).map((epic) => (
                <li data-testid="epic-row" key={epic.id} className="flex items-stretch gap-2">
                  <a className="block flex-1 rounded bg-slate-800 p-3" href={`?screen=project&epic=${epic.id}`}>
                    <p className="font-semibold">{epic.title}</p>
                    <p className="text-xs text-slate-400">
                      {epic.priority} · Needs you {epic.needs_you.length} · Landed {epic.landed.length} · Working{' '}
                      {epic.working.length}
                    </p>
                  </a>
                  <a className="shrink-0 self-center rounded bg-slate-700 px-3 py-1 text-sm" href={threadHref({ bead: epic.id })}>
                    Discuss
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
