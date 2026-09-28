// src/cockpit/savedFilters.ts — filters he saved under a name (plans/0021 decision
// 13), kept in Dexie settings and offered on the map and in Search.
import { settingsRepo } from '../data/repositories';
import type { SavedFilter } from '../model/filter';
import { useLiveQuery } from './hooks';

const SAVED_KEY = 'saved-filters';

export async function loadSavedFilters(): Promise<SavedFilter[]> {
  const value = (await settingsRepo.get(SAVED_KEY)) as SavedFilter[] | undefined;
  return Array.isArray(value) ? value : [];
}

export async function saveFilter(saved: SavedFilter): Promise<void> {
  const all = (await loadSavedFilters()).filter((existing) => existing.name !== saved.name);
  await settingsRepo.set(SAVED_KEY, [...all, saved]);
}

export async function deleteFilter(name: string): Promise<void> {
  await settingsRepo.set(
    SAVED_KEY,
    (await loadSavedFilters()).filter((existing) => existing.name !== name),
  );
}

export function useSavedFilters(): SavedFilter[] {
  return useLiveQuery(
    () => loadSavedFilters(),
    [],
    [] as SavedFilter[],
  );
}
