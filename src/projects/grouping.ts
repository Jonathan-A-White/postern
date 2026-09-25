// src/projects/grouping.ts — the ordering mw-f758y.2's "Projects screen" and
// "Project screen" paragraphs specify: pure functions over a decoded Snapshot
// (src/services/questions.ts), kept apart from the components so the sort order
// itself is unit-testable without rendering anything.
import type { SnapshotEpic, SnapshotLanded, SnapshotNeedsYou, SnapshotWorking } from '../services/questions';

/** Epics ordered by priority; any epic with something in Needs you floats to the top. */
export function sortEpics(epics: SnapshotEpic[]): SnapshotEpic[] {
  return [...epics].sort((a, b) => {
    const aRank = a.needs_you.length > 0 ? 0 : 1;
    const bRank = b.needs_you.length > 0 ? 0 : 1;
    return aRank !== bRank ? aRank - bRank : a.priority.localeCompare(b.priority);
  });
}

/** Needs you: oldest first. */
export function sortNeedsYou(items: SnapshotNeedsYou[]): SnapshotNeedsYou[] {
  return [...items].sort((a, b) => a.asked_at.localeCompare(b.asked_at));
}

/** Landed: newest first. */
export function sortLanded(items: SnapshotLanded[]): SnapshotLanded[] {
  return [...items].sort((a, b) => b.landed_at.localeCompare(a.landed_at));
}

/** Working: in-progress stories first, then the frontier (everything else) by priority. */
export function sortWorking(items: SnapshotWorking[]): SnapshotWorking[] {
  return [...items].sort((a, b) => {
    const aRank = a.status === 'in-progress' ? 0 : 1;
    const bRank = b.status === 'in-progress' ? 0 : 1;
    return aRank !== bRank ? aRank - bRank : a.priority.localeCompare(b.priority);
  });
}
