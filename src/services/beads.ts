// src/services/beads.ts — one bead's full detail (docs/protocol.md §12): its
// description, acceptance and every comment, fetched when the Governor zooms in
// and kept for offline reading and for search.
import { apiFetch } from './apiAuth';
import { openDocument } from './documents';
import { decodeBeadDetail, type BeadDetail } from '../model/view';
import { beadDetailsRepo } from '../data/repositories';

export interface FetchBeadOptions {
  key: Uint8Array;
  mayorKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export type BeadFetch = { status: 'ok'; detail: BeadDetail } | { status: 'missing' } | { status: 'unsupported' };

export async function fetchBeadDetail(id: string, options: FetchBeadOptions): Promise<BeadFetch> {
  const response = await apiFetch(`/beads/${encodeURIComponent(id)}`, undefined, {
    unlockedKey: options.key,
    apiBase: options.apiBase,
    fetchImpl: options.fetchImpl,
  });
  if (response.status === 404) {
    // A backend that predates §12 answers 404 for every id too; only a JSON
    // error body is the new backend saying this bead does not exist.
    const type = response.headers.get('Content-Type') ?? '';
    return type.includes('json') ? { status: 'missing' } : { status: 'unsupported' };
  }
  if (response.status === 501 || response.status === 405) return { status: 'unsupported' };
  if (!response.ok) throw new Error(`The backend answered ${response.status} for ${id}.`);
  const plaintext = await openDocument(await response.text(), { key: options.key, mayorKey: options.mayorKey });
  const detail = decodeBeadDetail(plaintext);
  await beadDetailsRepo.save({ id, plaintext, fetchedAt: Date.now() });
  return { status: 'ok', detail };
}

export async function storedBeadDetail(id: string): Promise<BeadDetail | undefined> {
  const row = await beadDetailsRepo.get(id);
  if (!row) return undefined;
  try {
    return decodeBeadDetail(row.plaintext);
  } catch {
    return undefined;
  }
}

export async function allStoredBeadDetails(): Promise<BeadDetail[]> {
  const rows = await beadDetailsRepo.getAll();
  const out: BeadDetail[] = [];
  for (const row of rows) {
    try {
      out.push(decodeBeadDetail(row.plaintext));
    } catch {
      // A row that no longer decodes is simply not searched.
    }
  }
  return out;
}
