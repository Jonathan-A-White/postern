// src/projects/ProjectScreen.tsx — one epic's three groups in the fixed order
// mw-f758y.2's "Project screen" paragraph sets: Needs you (oldest first), Landed
// (newest first), Working (in-progress then ready by priority). One row per
// bead: title, state badge, age; tap opens the bead screen.
import { formatAge } from '../services/age';
import { sortLanded, sortNeedsYou, sortWorking } from './grouping';
import { useSnapshotScreen } from './useSnapshotScreen';
import { VaultGate } from './VaultGate';

export interface ProjectScreenProps {
  epicId: string;
}

export function ProjectScreen({ epicId }: ProjectScreenProps) {
  const {
    vaultState,
    unlockError,
    phraseInput,
    setPhraseInput,
    handleUnlockWithFingerprint,
    handleUnlockWithPhrase,
    snapshotState,
    refresh,
  } = useSnapshotScreen();

  const epic = snapshotState.snapshot?.epics.find((candidate) => candidate.id === epicId);

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-900 p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">{epic?.title ?? 'Project'}</h1>
      <a className="text-sm underline" href="?screen=projects">
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

          {snapshotState.snapshot && !epic && <p>Project not found.</p>}

          {epic && (
            <>
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">Needs you</h2>
                {sortNeedsYou(epic.needs_you).length === 0 && <p className="text-sm text-slate-400">Nothing needs you.</p>}
                <ul className="flex flex-col gap-2">
                  {sortNeedsYou(epic.needs_you).map((item) => (
                    <li data-testid="needs-you-row" key={item.id}>
                      <a
                        className="block rounded bg-slate-800 p-3"
                        href={`?screen=bead&epic=${epicId}&kind=needs_you&bead=${item.id}`}
                      >
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-400">Needs you · {formatAge(item.asked_at)}</p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">Landed</h2>
                {sortLanded(epic.landed).length === 0 && <p className="text-sm text-slate-400">Nothing landed.</p>}
                <ul className="flex flex-col gap-2">
                  {sortLanded(epic.landed).map((item) => (
                    <li data-testid="landed-row" key={item.id}>
                      <a
                        className="block rounded bg-slate-800 p-3"
                        href={`?screen=bead&epic=${epicId}&kind=landed&bead=${item.id}`}
                      >
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-400">Landed · {formatAge(item.landed_at)}</p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">Working</h2>
                {sortWorking(epic.working).length === 0 && <p className="text-sm text-slate-400">Nothing working.</p>}
                <ul className="flex flex-col gap-2">
                  {sortWorking(epic.working).map((item) => (
                    <li data-testid="working-row" key={item.id}>
                      <a
                        className="block rounded bg-slate-800 p-3"
                        href={`?screen=bead&epic=${epicId}&kind=working&bead=${item.id}`}
                      >
                        <p className="font-semibold">{item.title}</p>
                        <p className="text-xs text-slate-400">
                          {item.status} · {formatAge(item.updated_at)}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
