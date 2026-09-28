// src/services/me.ts — who is who (docs/protocol.md §15): the backend says which
// key is the caller's and which is the Mayor's, and which of the protocol's v2
// features it serves. The Mayor's key is pinned the first time it is seen and a
// different one is never taken silently; an old backend that has no /api/me is
// "legacy", and the cockpit falls back to the snapshot, polling and chain sends.
import { Hash, Utils } from '@bsv/sdk';
import { apiFetch } from './apiAuth';
import { getMayorPublicKey, setMayorPublicKey } from './messages';
import { settingsRepo } from '../data/repositories';

export type Feature = 'direct' | 'events' | 'view' | 'beads' | 'me';

export interface Me {
  pubkey: string;
  mayor: string;
  network: string;
  features: Feature[];
}

export const LEGACY: Me = { pubkey: '', mayor: '', network: 'testnet', features: [] };

const PENDING_MAYOR_KEY = 'mayor-public-key-offered';

export class NoLicenceError extends Error {
  constructor() {
    super('This key holds no Postern licence.');
    this.name = 'NoLicenceError';
  }
}

export interface FetchMeOptions {
  key: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** GET /api/me. Resolves LEGACY for a backend that predates it (404/405), and
 * throws NoLicenceError for a 401 — the one signal the app needs to offer the
 * licence screen, without walking the chain itself. */
export async function fetchMe(options: FetchMeOptions): Promise<Me> {
  let response: Response;
  try {
    response = await apiFetch('/me', undefined, { unlockedKey: options.key, apiBase: options.apiBase, fetchImpl: options.fetchImpl });
  } catch (err) {
    if (err instanceof Error && err.message === 'Licence required') throw new NoLicenceError();
    throw err;
  }
  if (response.status === 404 || response.status === 405) return LEGACY;
  if (!response.ok) throw new Error(`The backend answered ${response.status} to /api/me.`);
  const body = (await response.json()) as Partial<Me>;
  return {
    pubkey: typeof body.pubkey === 'string' ? body.pubkey : '',
    mayor: typeof body.mayor === 'string' ? body.mayor : '',
    network: typeof body.network === 'string' ? body.network : 'testnet',
    features: Array.isArray(body.features) ? (body.features.filter((f) => typeof f === 'string') as Feature[]) : [],
  };
}

export interface MayorKeyState {
  /** The key messages are encrypted to and the view must come from. */
  pinned?: string;
  /** A different key the backend now names, waiting on the Governor's word. */
  offered?: string;
}

/** Pins `announced` when nothing is pinned yet; when it differs from the pinned
 * key, records it as offered and keeps the pinned one. */
export async function reconcileMayorKey(announced: string): Promise<MayorKeyState> {
  const pinned = await getMayorPublicKey();
  if (!announced) return { pinned, offered: (await settingsRepo.get(PENDING_MAYOR_KEY)) as string | undefined };
  if (!pinned) {
    await setMayorPublicKey(announced);
    await settingsRepo.set(PENDING_MAYOR_KEY, undefined);
    return { pinned: announced };
  }
  if (pinned === announced) {
    await settingsRepo.set(PENDING_MAYOR_KEY, undefined);
    return { pinned };
  }
  await settingsRepo.set(PENDING_MAYOR_KEY, announced);
  return { pinned, offered: announced };
}

/** The Governor accepts the offered key: it becomes the pinned one. */
export async function acceptOfferedMayorKey(): Promise<string | undefined> {
  const offered = (await settingsRepo.get(PENDING_MAYOR_KEY)) as string | undefined;
  if (!offered) return undefined;
  await setMayorPublicKey(offered);
  await settingsRepo.set(PENDING_MAYOR_KEY, undefined);
  return offered;
}

export async function mayorKeyState(): Promise<MayorKeyState> {
  return {
    pinned: await getMayorPublicKey(),
    offered: (await settingsRepo.get(PENDING_MAYOR_KEY)) as string | undefined,
  };
}

/** A key's fingerprint, the way millwright's contrib/install-hands-root prints
 * it (docs/protocol.md §17): the first 16 hex digits of the SHA-256 of the key's
 * hex text, in groups of four — so he can check the key the installer is about
 * to trust is the one this phone holds. */
export function fingerprint(publicKeyHex: string): string {
  const digest = Utils.toHex(Hash.sha256(Utils.toArray(publicKeyHex, 'utf8')));
  return digest.slice(0, 16).replace(/(.{4})(?!$)/g, '$1 ');
}
