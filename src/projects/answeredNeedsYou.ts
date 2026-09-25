// src/projects/answeredNeedsYou.ts — mw-tfne4.5: Needs you hides a bead the moment
// its answer row exists, rather than waiting for the snapshot's next tick to catch
// up (mw-f758y.2's "How it becomes his word on a bead" paragraph).
import { answersRepo } from '../data/repositories';
import type { Snapshot } from '../services/questions';

export async function hideAnsweredNeedsYou(snapshot: Snapshot): Promise<Snapshot> {
  const answeredBeadIds = await answersRepo.answeredBeadIds();
  if (answeredBeadIds.size === 0) return snapshot;
  return {
    ...snapshot,
    epics: snapshot.epics.map((epic) => ({
      ...epic,
      needs_you: epic.needs_you.filter((item) => !answeredBeadIds.has(item.id)),
    })),
  };
}
