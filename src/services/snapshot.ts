// src/services/snapshot.ts — GET /snapshot (docs/protocol.md §7): the raw BRC-78
// ciphertext, base64-encoded as the response body text, decrypted with the
// unlocked key into the JSON every Projects/Project/bead screen reads. The last
// good copy is cached in Dexie (src/data/repositories/snapshot-repo.ts) so a
// failed fetch — offline, or a key that can't decrypt it — still has something
// to show, with the failure named alongside it.
import { snapshotRepo } from '../data/repositories';
import { decodeSnapshot, type Snapshot } from './questions';
import { decryptSnapshotCiphertext } from './messages';

export const SNAPSHOT_URL = '/snapshot';

/** True when `text` could plausibly be the base64 ciphertext docs/protocol.md §7
 * promises, ruling out an nginx SPA fallback (index.html) or an empty body before
 * a decode is even attempted — so the user sees "no snapshot yet", not a decoder's
 * internal complaint about padding or an invalid character. */
function looksLikeBase64Ciphertext(text: string): boolean {
  const cleaned = text.replace(/[\r\n\t\f\v ]+/g, '');
  if (cleaned.length === 0) return false;
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned);
}

function isValidSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.written_at !== 'string' || !Array.isArray(snapshot.epics)) return false;
  return snapshot.epics.every((epic) => {
    if (typeof epic !== 'object' || epic === null) return false;
    const e = epic as Record<string, unknown>;
    return (
      typeof e.id === 'string' &&
      typeof e.title === 'string' &&
      typeof e.priority === 'string' &&
      typeof e.status === 'string' &&
      Array.isArray(e.needs_you) &&
      Array.isArray(e.landed) &&
      Array.isArray(e.working) &&
      typeof e.closed_count === 'number'
    );
  });
}

export interface FetchSnapshotParams {
  /** This phone's own unlocked private key, hex-encoded. */
  unlockedKeyHex: string;
  fetchImpl?: typeof fetch;
  url?: string;
}

export interface SnapshotResult {
  snapshot: Snapshot;
  /** True when this is the cached copy from a previous fetch, not a fresh one. */
  offline: boolean;
  /** Set when the fetch, decrypt or shape check failed and the cached copy is shown instead. */
  error?: string;
}

/**
 * Fetches and decrypts the snapshot, caching the plaintext in Dexie on success.
 * On any failure (network, decrypt, or an unexpected shape) falls back to the
 * cached copy with `offline: true` and `error` naming what went wrong; rethrows
 * only when there is no cached copy to fall back to.
 */
export async function fetchSnapshot(params: FetchSnapshotParams): Promise<SnapshotResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = params.url ?? SNAPSHOT_URL;

  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Could not fetch the snapshot (${response.status}).`);
    const base64Ciphertext = (await response.text()).trim();
    if (!looksLikeBase64Ciphertext(base64Ciphertext)) throw new Error('No snapshot published yet.');
    const plaintext = decryptSnapshotCiphertext(base64Ciphertext, params.unlockedKeyHex);
    const snapshot = decodeSnapshot(plaintext);
    if (!isValidSnapshot(snapshot)) throw new Error('The snapshot was not shaped as expected.');
    await snapshotRepo.save({ plaintext, written_at: snapshot.written_at });
    return { snapshot, offline: false };
  } catch (err) {
    const cached = await snapshotRepo.get();
    if (!cached) throw err;
    return { snapshot: decodeSnapshot(cached.plaintext), offline: true, error: (err as Error).message };
  }
}
