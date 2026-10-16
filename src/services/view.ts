// src/services/view.ts — keeps the phone's copy of the live view (docs/protocol.md
// §11) current: a conditional GET /api/view, decrypted and checked against the
// pinned Mayor, stored in Dexie so the cockpit opens instantly and offline. An old
// backend without /api/view gets its §7 snapshot read and converted instead.
import { API_TIMEOUT_MS, apiFetch, withTimeout } from './apiAuth';
import { openDocument } from './documents';
import { decryptSnapshotCiphertext } from './messages';
import { decodeSnapshot } from './questions';
import { decodeView, viewFromSnapshot, type View } from '../model/view';
import { viewRepo } from '../data/repositories';
import { VIEW_MIN_INTERVAL_MS, viewThrottle } from './viewThrottle';
import { Utils } from '@bsv/sdk';

export const SNAPSHOT_URL = '/snapshot';
export { resetViewThrottle, VIEW_BEHIND_INTERVAL_MS, VIEW_MIN_INTERVAL_MS } from './viewThrottle';

export type ViewRefresh = 'updated' | 'unchanged' | 'absent';

/** Why the whole view is asked for, sent as `GET /api/view?why=` so the backend's log says it and a count of fetches
 * reads from the log alone (mw-7dige5.5): the session's `start`; a first `hello` naming another view, or a `reconnect`'s;
 * a `gap` in the events' seqs, or a batch that could not be applied (`unapplied`); `behind`, the events having named
 * something only the home builds; a `view-event` before any batch; `poll` on a backend without events; a tap on a
 * Refresh button (`refresh`); a bead the Map was sent to that the copy does not hold (`focus`); the Mayor's key
 * accepted (`mayor-key`); and a return to the app's bodiless `probe` (src/services/live.ts). */
export type ViewWhy = 'start' | 'hello' | 'reconnect' | 'gap' | 'unapplied' | 'behind' | 'view-event' | 'poll' | 'refresh' | 'focus' | 'mayor-key' | 'probe';

export interface RefreshViewOptions {
  key: Uint8Array;
  mayorKey?: string;
  /** Whether the backend serves /api/view (docs/protocol.md §15's features). */
  live: boolean;
  apiBase?: string;
  snapshotUrl?: string;
  fetchImpl?: typeof fetch;
  /** Why it is asked for: the backend logs it. */
  why: ViewWhy;
  /** The least time since the last full fetch: VIEW_MIN_INTERVAL_MS unless given (VIEW_BEHIND_INTERVAL_MS for `behind`). */
  within?: number;
  /** A tap on a Refresh button: fetched now whatever the throttle says. The fetch still asks with the held ETag. */
  force?: boolean;
}

async function refreshLive(options: RefreshViewOptions): Promise<ViewRefresh> {
  const stored = await viewRepo.get();
  const headers: Record<string, string> = {};
  if (stored?.source === 'live' && stored.etag) headers['If-None-Match'] = stored.etag;
  const response = await apiFetch(`/view?why=${options.why}`, { headers }, { unlockedKey: options.key, apiBase: options.apiBase, fetchImpl: options.fetchImpl });
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
  // Not an /api call, so apiFetch's bound is given here: a snapshot that never answers would hold the sync for good (mw-q6n8m0.15).
  const abort = new AbortController();
  const giveUp = () => abort.abort();
  const response = await withTimeout(fetchImpl(options.snapshotUrl ?? SNAPSHOT_URL, { cache: 'no-store', signal: abort.signal }), false, API_TIMEOUT_MS, giveUp);
  if (response.status === 404) return 'absent';
  if (!response.ok) throw new Error(`The snapshot answered ${response.status}.`);
  const sealed = (await withTimeout(response.text(), false, API_TIMEOUT_MS, giveUp)).trim();
  if (!looksLikeBase64Ciphertext(sealed)) return 'absent';
  const snapshotPlaintext = decryptSnapshotCiphertext(sealed, Utils.toHex(Array.from(options.key)));
  const view = viewFromSnapshot(decodeSnapshot(snapshotPlaintext));
  const stored = await viewRepo.get();
  if (stored?.source === 'snapshot' && stored.written_at === view.written_at) return 'unchanged';
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'snapshot', fetchedAt: Date.now() });
  return 'updated';
}

async function fetchView(options: RefreshViewOptions): Promise<ViewRefresh> {
  if (options.live) {
    const result = await refreshLive(options);
    if (result !== 'absent') return result;
  }
  return refreshFromSnapshot(options);
}

async function fetchNow(options: RefreshViewOptions): Promise<ViewRefresh> {
  if (viewThrottle.trailing) clearTimeout(viewThrottle.trailing.timer);
  viewThrottle.trailing = undefined;
  viewThrottle.lastFetchAt = performance.now();
  return fetchView(options);
}

/** Brings the stored view up to date from whichever source the backend has. The whole view is large, so every
 * caller shares one throttle (mw-7dige5.4): a call fetches at once when the last full fetch is `within` (a minute
 * unless given) behind it; otherwise it is one fetch when that window ends, and resolves 'unchanged' without waiting
 * for it (the view it wants arrives through Dexie's live queries). Only the soonest waiting fetch is kept, since it
 * brings what a later one would. `force` goes through the window. */
export async function refreshView(options: RefreshViewOptions): Promise<ViewRefresh> {
  if (options.force) return fetchNow(options);
  const due = viewThrottle.lastFetchAt + (options.within ?? VIEW_MIN_INTERVAL_MS);
  const wait = due - performance.now();
  if (wait <= 0) return fetchNow(options);
  const waiting = viewThrottle.trailing;
  if (waiting && waiting.due < due) return 'unchanged';
  if (waiting) clearTimeout(waiting.timer);
  const timer = setTimeout(() => void fetchNow(options).catch(() => undefined), wait);
  viewThrottle.trailing = { timer, due, options };
  return 'unchanged';
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
