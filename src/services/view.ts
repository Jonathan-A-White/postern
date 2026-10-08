// src/services/view.ts — keeps the phone's copy of the live view (docs/protocol.md
// §11) current: a conditional GET /api/view, decrypted and checked against the
// pinned Mayor, stored in Dexie so the cockpit opens instantly and offline. An old
// backend without /api/view gets its §7 snapshot read and converted instead.
import { apiFetch } from './apiAuth';
import { openDocument } from './documents';
import { decryptSnapshotCiphertext } from './messages';
import { decodeSnapshot } from './questions';
import { decodeView, viewFromSnapshot, type View } from '../model/view';
import { viewRepo } from '../data/repositories';
import { Utils } from '@bsv/sdk';

export const SNAPSHOT_URL = '/snapshot';

export type ViewRefresh = 'updated' | 'unchanged' | 'absent';

export interface RefreshViewOptions {
  key: Uint8Array;
  mayorKey?: string;
  /** Whether the backend serves /api/view (docs/protocol.md §15's features). */
  live: boolean;
  apiBase?: string;
  snapshotUrl?: string;
  fetchImpl?: typeof fetch;
}

async function refreshLive(options: RefreshViewOptions): Promise<ViewRefresh> {
  const stored = await viewRepo.get();
  const headers: Record<string, string> = {};
  if (stored?.source === 'live' && stored.etag) headers['If-None-Match'] = stored.etag;
  const response = await apiFetch('/view', { headers }, { unlockedKey: options.key, apiBase: options.apiBase, fetchImpl: options.fetchImpl });
  if (response.status === 304) return 'unchanged';
  if (response.status === 404) return 'absent';
  if (!response.ok) throw new Error(`The backend answered ${response.status} for the view.`);
  const body = await response.text();
  const plaintext = await openDocument(body, { key: options.key, mayorKey: options.mayorKey });
  const view = decodeView(plaintext);
  await viewRepo.save({
    plaintext,
    written_at: view.written_at,
    etag: response.headers.get('ETag') ?? undefined,
    source: 'live',
    fetchedAt: Date.now(),
  });
  return 'updated';
}

/** True when `text` could be the base64 ciphertext docs/protocol.md §7 promises. An nginx
 * SPA fallback (index.html) or an empty body at /snapshot is not one: it means no snapshot
 * is published, and must not reach the base64 decoder, whose raw error is no use to anyone. */
function looksLikeBase64Ciphertext(text: string): boolean {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(text.replace(/\s+/g, ''));
}

async function refreshFromSnapshot(options: RefreshViewOptions): Promise<ViewRefresh> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.snapshotUrl ?? SNAPSHOT_URL, { cache: 'no-store' });
  if (response.status === 404) return 'absent';
  if (!response.ok) throw new Error(`The snapshot answered ${response.status}.`);
  const sealed = (await response.text()).trim();
  if (!looksLikeBase64Ciphertext(sealed)) return 'absent';
  const snapshotPlaintext = decryptSnapshotCiphertext(sealed, Utils.toHex(Array.from(options.key)));
  const view = viewFromSnapshot(decodeSnapshot(snapshotPlaintext));
  const stored = await viewRepo.get();
  if (stored?.source === 'snapshot' && stored.written_at === view.written_at) return 'unchanged';
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'snapshot', fetchedAt: Date.now() });
  return 'updated';
}

/** Brings the stored view up to date from whichever source the backend has. */
export async function refreshView(options: RefreshViewOptions): Promise<ViewRefresh> {
  if (options.live) {
    const result = await refreshLive(options);
    if (result !== 'absent') return result;
  }
  return refreshFromSnapshot(options);
}

/** The stored view, decoded, or undefined before the first one arrives. */
export async function storedView(): Promise<{ view: View; fetchedAt: number; source: 'live' | 'snapshot' } | undefined> {
  const row = await viewRepo.get();
  if (!row) return undefined;
  try {
    return { view: decodeView(row.plaintext), fetchedAt: row.fetchedAt, source: row.source };
  } catch {
    return undefined;
  }
}
