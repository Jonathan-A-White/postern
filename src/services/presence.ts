// src/services/presence.ts — whether the Mayor is here (docs/protocol.md §20,
// "Presence"): the backend says so while his key holds the event stream open, which is
// what `mw talk wait` does. Anything but a plain answer (a backend without the route, a
// standby, no network, a refusal) is "unknown", never a guess either way.
import { apiFetch } from './apiAuth';

export interface PresenceOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** True while the Mayor is here, false while he is away, undefined when the backend cannot say. */
export async function fetchMayorHere(key: Uint8Array, options: PresenceOptions = {}): Promise<boolean | undefined> {
  try {
    const response = await apiFetch('/presence', undefined, { unlockedKey: key, ...options });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { mayor?: unknown };
    return typeof body.mayor === 'boolean' ? body.mayor : undefined;
  } catch {
    return undefined;
  }
}
