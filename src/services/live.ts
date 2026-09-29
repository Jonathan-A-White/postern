// src/services/live.ts — the cockpit's one connection to the factory (plans/0021
// decisions 5 and 6). Once the key is unlocked it asks who is who (§15), pins
// the Mayor, brings the view and the messages up to date, then listens on the
// event stream (§10) so a message or a change to the map arrives within a
// second. A backend without the stream is polled instead. Screens read its
// state through useLive(); everything they show comes from Dexie, which this
// keeps current.
import { useSyncExternalStore } from 'react';
import { apiFetch } from './apiAuth';
import { syncMessages } from './inbox';
import { fetchMe, LEGACY, NoLicenceError, reconcileMayorKey, type Me } from './me';
import { refreshView } from './view';
import { publicKeyHexFromMasterKey } from './vault';
import type { DeliverOptions } from './deliver';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'polling' | 'reconnecting' | 'offline' | 'unlicensed';

export interface LiveState {
  status: LiveStatus;
  me: Me | null;
  mayorKey?: string;
  offeredMayorKey?: string;
  /** When the phone last heard from the backend, ms since the epoch. */
  lastHeard?: number;
  error?: string;
  /** How many times the stream has come back after a drop; screens with
   * something that failed while it was down retry when this changes. */
  reconnects: number;
}

const POLL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

let state: LiveState = { status: 'idle', me: null, reconnects: 0 };
const listeners = new Set<() => void>();
let current: { key: Uint8Array; abort: AbortController } | null = null;

function setState(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The stream is back after a drop: tells whoever failed while it was down. */
export function noteReconnect(): void {
  setState({ reconnects: state.reconnects + 1 });
}

export function getLiveState(): LiveState {
  return state;
}

export function useLive(): LiveState {
  return useSyncExternalStore(subscribeLive, getLiveState, getLiveState);
}

export function hasFeature(feature: Me['features'][number]): boolean {
  return state.me?.features.includes(feature) ?? false;
}

/** What deliver() needs, once the Mayor is known; null before then. */
export function deliverOptions(key: Uint8Array | null): DeliverOptions | null {
  if (!key || !state.mayorKey) return null;
  return { key, mayorKey: state.mayorKey, direct: hasFeature('direct') };
}

let syncing: Promise<void> = Promise.resolve();

function queue(task: () => Promise<void>): Promise<void> {
  syncing = syncing.then(task, task);
  return syncing;
}

/** Resolves true when every part of the sync succeeded. */
async function syncAll(key: Uint8Array, what: { messages?: boolean; view?: boolean }): Promise<boolean> {
  let ok = false;
  await queue(async () => {
    const errors: string[] = [];
    if (what.messages) {
      try {
        await syncMessages({ publicKeyHex: publicKeyHexFromMasterKey(key), unlockedKey: key });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (what.view) {
      try {
        await refreshView({ key, mayorKey: state.mayorKey, live: hasFeature('view') });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    ok = errors.length === 0;
    if (ok) setState({ lastHeard: Date.now(), error: undefined });
    else setState({ error: errors.join('; ') });
  });
  return ok;
}

/** Parses the text of one server-sent event block ("event: x\ndata: {...}"). */
export function parseEventBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line === '') continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length || event !== 'message' ? { event, data: data.join('\n') } : null;
}

async function listen(key: Uint8Array, signal: AbortSignal): Promise<void> {
  const response = await apiFetch('/events', { headers: { Accept: 'text/event-stream' }, signal }, { unlockedKey: key });
  if (!response.ok || !response.body) throw new Error(`The event stream answered ${response.status}.`);
  const recovered = state.status === 'reconnecting' || state.status === 'offline';
  setState({ status: 'live', lastHeard: Date.now(), error: undefined });
  if (recovered) noteReconnect();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const parsed = parseEventBlock(block);
      setState({ lastHeard: Date.now() });
      if (parsed?.event === 'hello') void syncAll(key, { messages: true, view: true });
      else if (parsed?.event === 'message') void syncAll(key, { messages: true });
      else if (parsed?.event === 'view') void syncAll(key, { view: true });
      split = buffer.indexOf('\n\n');
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function run(key: Uint8Array, signal: AbortSignal): Promise<void> {
  setState({ status: 'connecting', error: undefined });
  let me: Me;
  try {
    me = await fetchMe({ key });
  } catch (err) {
    if (err instanceof NoLicenceError) {
      setState({ status: 'unlicensed', me: null, error: err.message });
      return;
    }
    me = LEGACY;
    setState({ status: 'offline', error: err instanceof Error ? err.message : String(err) });
  }
  const keys = await reconcileMayorKey(me.mayor);
  setState({ me, mayorKey: keys.pinned, offeredMayorKey: keys.offered });
  await syncAll(key, { messages: true, view: true });

  let backoff = 1000;
  // Whether the sync after the last stream error failed too: only then, with the
  // next reconnect failing as well, is the backend really unreachable.
  let recoverySyncFailed = false;
  while (!signal.aborted) {
    if (me.features.includes('events')) {
      try {
        await listen(key, signal);
        backoff = 1000;
        recoverySyncFailed = false;
      } catch (err) {
        if (signal.aborted) return;
        // A dropped stream is usually a blip (a suspended phone, a network
        // change): say 'reconnecting', and 'offline' only once a reconnect and
        // the sync after the drop have both failed.
        setState({ status: recoverySyncFailed ? 'offline' : 'reconnecting', error: err instanceof Error ? err.message : String(err) });
      }
      await sleep(backoff, signal);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      if (!signal.aborted) recoverySyncFailed = !(await syncAll(key, { messages: true, view: true }));
    } else {
      setState({ status: state.error ? 'offline' : 'polling' });
      await sleep(POLL_MS, signal);
      if (!signal.aborted && (typeof document === 'undefined' || !document.hidden)) {
        await syncAll(key, { messages: true, view: true });
        if (!state.error && state.status === 'offline') setState({ status: 'polling' });
      }
    }
  }
}

/** Connects with `key`; a second call with the same key is a no-op. */
export function startLive(key: Uint8Array): void {
  if (current && current.key === key && !current.abort.signal.aborted) return;
  stopLive();
  const abort = new AbortController();
  current = { key, abort };
  void run(key, abort.signal);
}

export function stopLive(): void {
  current?.abort.abort();
  current = null;
  setState({ status: 'idle' });
}

/** Pull everything now (pull-to-refresh, a notification tap, a Retry button). */
export async function refreshNow(): Promise<void> {
  if (!current) return;
  await syncAll(current.key, { messages: true, view: true });
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener?.('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === 'sync-inbox') void refreshNow();
  });
}
