// src/services/ideasOnly.ts — Ideas only (docs/protocol.md §25): the backend keeps each key's
// setting and works out whether the mode is on now, so the app asks (GET /api/ideas-only/{key}),
// changes it (PUT, the whole setting, only for its own key) and hears the stream's `ideas-only`
// event. The last answer is kept in the settings table so the Settings section and the banner
// read with no network.
import { accountsRepo, settingsRepo } from '../data/repositories';
import { EMPTY_SETTING, onUntil, readAnswer, recordedWords, type IdeasOnlyKept, type IdeasOnlySetting } from '../model/ideasOnly';
import { apiFetch } from './apiAuth';
import { getKey } from './keySession';
import { publicKeyHexFromMasterKey } from './vault';

export type { IdeasOnlyKept, IdeasOnlySetting };

export interface IdeasOnlyOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** What asking or saving came to: the answer kept, or why not. */
export type IdeasOnlyResult =
  | { ok: true; kept: IdeasOnlyKept }
  | { ok: false; reason: 'older' | 'unreachable' | 'refused'; message: string };

const path = (keyHex: string): string => `/ideas-only/${keyHex}`;

async function keep(keyHex: string, response: Response, accountId: string): Promise<IdeasOnlyResult> {
  const answer = readAnswer(await response.json().catch(() => undefined));
  if (!answer) return { ok: false, reason: 'unreachable', message: 'The backend answered with something that is not Ideas only.' };
  const kept: IdeasOnlyKept = { key: keyHex, ...answer, at: Date.now() };
  // The answer is the account's that asked, whichever account is active when it comes (mw-9rp4hu.5).
  await accountsRepo.update(accountId, { ideasOnly: kept });
  return { ok: true, kept };
}

async function refusal(response: Response): Promise<IdeasOnlyResult> {
  // 404 and 501: a backend without the route or the store, so an older one.
  if (response.status === 404 || response.status === 501) return { ok: false, reason: 'older', message: 'Ideas only needs a newer backend.' };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  const said = typeof body.error === 'string' ? body.error : `The backend answered ${response.status}.`;
  return { ok: false, reason: 'refused', message: said };
}

async function ask(key: Uint8Array, init: RequestInit | undefined, options: IdeasOnlyOptions): Promise<IdeasOnlyResult> {
  const keyHex = publicKeyHexFromMasterKey(key);
  const accountId = accountsRepo.activeNow().id;
  try {
    const response = await apiFetch(path(keyHex), init, { unlockedKey: key, apiBase: accountsRepo.activeNow().backendUrl, ...options });
    return response.ok ? await keep(keyHex, response, accountId) : await refusal(response);
  } catch (err) {
    return { ok: false, reason: 'unreachable', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Asks the backend for this key's setting and state, and keeps the answer. */
export function getIdeasOnly(key: Uint8Array, options: IdeasOnlyOptions = {}): Promise<IdeasOnlyResult> {
  return ask(key, undefined, options);
}

/** Replaces this key's whole setting; the answer (the backend's own stamp and state) is kept. */
export function putIdeasOnly(key: Uint8Array, setting: IdeasOnlySetting, options: IdeasOnlyOptions = {}): Promise<IdeasOnlyResult> {
  const { until, schedule, reaches } = setting; // updatedAt and updatedBy are the server's to stamp
  const body = JSON.stringify({ until, ...(schedule ? { schedule } : {}), reaches });
  return ask(key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }, options);
}

/** The setting a change starts from: the kept one, else an empty one. */
export function baseSetting(kept: IdeasOnlyKept | undefined): IdeasOnlySetting {
  return kept?.setting ?? EMPTY_SETTING;
}

/** The stream's `ideas-only` event (§10, §25): `{key, on, until}`. One for my key updates the kept state; any other changes nothing. Whether it changed anything. */
export async function applyIdeasOnlyEvent(myKeyHex: string, data: string, accountId: string = accountsRepo.activeNow().id): Promise<boolean> {
  let event: { key?: unknown; on?: unknown; until?: unknown };
  try {
    event = JSON.parse(data) as typeof event;
  } catch {
    return false;
  }
  if (typeof event.key !== 'string' || event.key.toLowerCase() !== myKeyHex.toLowerCase() || typeof event.on !== 'boolean') return false;
  const until = event.on && typeof event.until === 'number' ? event.until : 0;
  const stored = (await accountsRepo.list()).find((account) => account.id === accountId)?.ideasOnly;
  const kept = stored?.key === myKeyHex ? stored : undefined;
  // The event does not say what turned it on; the answer asked for right after does.
  const by = !event.on ? '' : kept?.state.on ? kept.state.by : 'until';
  await accountsRepo.update(accountId, { ideasOnly: { key: myKeyHex, setting: baseSetting(kept), state: { on: event.on, until, by }, at: Date.now() } });
  return true;
}

/** What live.ts does with the event: keep it at once, then ask for the exact state. */
export async function onIdeasOnlyEvent(key: Uint8Array, data: string): Promise<void> {
  const accountId = accountsRepo.activeNow().id;
  // The exact state is asked for by the account the event came to: if the app has moved on, that account asks when it is next active.
  if ((await applyIdeasOnlyEvent(publicKeyHexFromMasterKey(key), data, accountId)) && accountsRepo.activeNow().id === accountId) await getIdeasOnly(key);
}

/** 'Recorded for after 21:00' when Ideas only is on for this phone's key right now, else undefined: what a send writes on its row. */
export async function recordedNoteNow(): Promise<string | undefined> {
  const key = getKey();
  if (!key) return undefined;
  const kept = await settingsRepo.getIdeasOnly();
  if (kept?.key !== publicKeyHexFromMasterKey(key)) return undefined;
  const until = onUntil(kept, Date.now());
  return until === undefined ? undefined : recordedWords(until, Date.now());
}
