// src/services/standby.ts — whether the backend that answered is a host that is
// not home (docs/api.md's Standby): it answers 503 {"standby": true, "home": …}
// to every route but the ones a send needs. apiFetch reports each response here,
// so every screen can say 'Home is down' and offer the move (mw-43v9x.9). The
// hosts a home can be: the desktop and the laptop, never the VPS.
import { useSyncExternalStore } from 'react';

export const HOMES = ['desktop', 'laptop'] as const;
export type HomeHost = (typeof HOMES)[number];

export function isHomeHost(value: unknown): value is HomeHost {
  return HOMES.includes(value as HomeHost);
}

/** What a standby answer said: `home` is what the backend's home command printed. */
export interface StandbyState {
  home?: string;
}

/** The routes a standby host still serves, so a move-home can be sent (docs/api.md). */
const SERVED_IN_STANDBY = ['/challenge', '/messages', '/me', '/utxos/', '/broadcast'];

let standby: StandbyState | null = null;
const listeners = new Set<() => void>();

function set(next: StandbyState | null): void {
  standby = next;
  for (const listener of listeners) listener();
}

export function getStandby(): StandbyState | null {
  return standby;
}

export function clearStandby(): void {
  if (standby) set(null);
}

export function useStandby(): StandbyState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStandby,
    getStandby,
  );
}

/** The hosts to offer a move to: every host but the one that is (or was) home. */
export function hostsToMoveTo(home: string | undefined): HomeHost[] {
  return HOMES.filter((host) => host !== home);
}

/** Called with every /api response: a standby 503 raises the state, and an answer
 * from a route standby does not serve ends it. */
export async function noteApiResponse(path: string, response: Response): Promise<void> {
  if (response.status === 503) {
    try {
      const body = (await response.clone().json()) as { standby?: unknown; home?: unknown };
      if (body.standby === true) set({ home: typeof body.home === 'string' && body.home.trim() ? body.home.trim() : undefined });
    } catch {
      // a 503 that is not the standby answer (a proxy's page) says nothing about home
    }
    return;
  }
  if (response.ok && !SERVED_IN_STANDBY.some((served) => path.startsWith(served))) clearStandby();
}
