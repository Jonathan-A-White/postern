// src/services/live.ts — the cockpit's one connection to the factory (plans/0021
// decisions 5 and 6). Once the key is unlocked it asks who is who (§15), pins
// the Mayor, brings the view and the messages up to date, then listens on the
// event stream (§10) so a message or a change to the map arrives within a
// second. A backend without the stream is polled instead. Screens read its
// state through useLive(); everything they show comes from Dexie, which this
// keeps current. While the backend cannot be reached it also reads the anchor
// address from the chain itself every 5 s, backing off to 60 s when WhatsOnChain fails, refuses or has nothing new, and not at all while the page is hidden (docs/protocol.md §21): a record
// found there is kept, a ring rings, and the backend is tried again at once.
// The factory's events (§22) come in the message sync and are projected onto the
// stored view (src/services/events.ts); once they flow, the stream's `view` event
// is only the recovery path, for when no events batch follows it. The line never says live over a dead
// link: a stream with no ping for STREAM_STALE_MS is read as dropped, and a send the backend does not
// answer (deliver's onUnreachable) drops it to reconnecting at once. A backend that did not answer /api/me
// when the app opened is asked again on every turn of the loop until it does, so the stream and the
// direct road come back by themselves (mw-gq6.276). The events found
// on the chain while the backend is out of reach go through the same projector (a
// batch seen on both roads applies once, by seq); a gap on that road is tolerated
// until the backend returns and the view is fetched.
import { useSyncExternalStore } from 'react';
import { apiFetch } from './apiAuth';
import { readChain, nextChainDelay, CHAIN_POLL_MS } from './chainRead';
import { projectBatches, syncMessagesAndEvents } from './events';
import type { EventBatch } from '../model/events';
import { freshRings, ringInApp } from './ringIn';
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
  /** The backend cannot be reached but the phone is reading the anchor address itself (§21, §22): the queue is flowing from the chain. */
  chainLive?: boolean;
  error?: string;
  /** How many times the stream has come back after a drop; screens with
   * something that failed while it was down retry when this changes. */
  reconnects: number;
  /** How many message syncs have finished, whether they worked or not; a screen
   * waiting for a message to arrive counts these rather than a clock. */
  syncs: number;
}

const POLL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
/** The stream pings every 25 s (docs/api.md); this long with no word is a socket the OS suspended, or a link that died without an error. */
const STREAM_STALE_MS = 60_000;
/** How often an open stream is checked for having gone quiet. */
const STALE_CHECK_MS = 5_000;
/** Two returns to the foreground closer than this are one. */
const FOREGROUND_DEBOUNCE_MS = 3_000;
/** Once events flow, how long a `view` event waits for an events batch to make fetching the view needless. */
const VIEW_GRACE_MS = 10_000;

let state: LiveState = { status: 'idle', me: null, reconnects: 0, syncs: 0 };
const listeners = new Set<() => void>();
let current: { key: Uint8Array; abort: AbortController; interrupt?: AbortController } | null = null;
let lastForeground = 0;
/** When this session last applied an events batch (ms), 0 before the first. */
let lastProjected = 0;
let viewWait: ReturnType<typeof setTimeout> | undefined;

function setState(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
  watchChainWhileDown();
}

/** The chain read that runs while the backend is out of reach, and the transactions it has read this session. */
let chainWatch: AbortController | null = null;
const chainSeen = new Set<string>();

/** Whether the backend cannot be reached right now: the stream dropped, or it never came up. */
function backendOutOfReach(): boolean {
  return current !== null && (state.status === 'offline' || state.status === 'reconnecting');
}

/** Starts the chain read when the backend goes out of reach and stops it the moment the stream is back (or live stops). */
function watchChainWhileDown(): void {
  if (backendOutOfReach() && !chainWatch) {
    const abort = new AbortController();
    chainWatch = abort;
    void pollChain(abort.signal);
  } else if (!backendOutOfReach() && chainWatch) {
    chainWatch.abort();
    chainWatch = null;
    if (state.chainLive) setState({ chainLive: false });
  }
}

/** The events the chain read found (§22), projected like the backend's: a gap is tolerated until the backend returns, whose view then fills it in. */
async function applyChainEvents(batches: EventBatch[]): Promise<void> {
  await queue(async () => {
    try {
      const projected = await projectBatches(batches);
      if (projected.applied.length > 0) lastProjected = Date.now();
    } catch {
      // the backend's own feed brings the batch again when it is back
    }
  });
}

async function pollChain(signal: AbortSignal): Promise<void> {
  let delay = CHAIN_POLL_MS;
  for (;;) {
    await sleep(delay, signal);
    const session = current;
    if (signal.aborted || !session) return;
    if (typeof document !== 'undefined' && document.hidden) continue; // a page nobody is looking at reads nothing; the wait stays as it was
    let read;
    try {
      read = await readChain({ publicKeyHex: publicKeyHexFromMasterKey(session.key), unlockedKey: session.key, mayorKey: state.mayorKey, seen: chainSeen, signal });
    } catch {
      if (!signal.aborted && state.chainLive) setState({ chainLive: false });
      delay = nextChainDelay(delay, false, false);
      continue; // WhatsOnChain is out of reach too (or refuses us): the next read waits longer
    }
    if (signal.aborted) return;
    // A transaction that failed is a WhatsOnChain in trouble: back off, and ask for it again. A read that found nothing new backs off too: an empty chain is asked for less and less often until a record arrives.
    delay = nextChainDelay(delay, read.failed === 0, read.rows.length > 0 || read.events.length > 0);
    if (!state.chainLive) setState({ chainLive: true });
    if (read.events.length > 0) await applyChainEvents(read.events);
    if (read.rows.length === 0) continue; // events alone are no reason to hammer the backend: its own backoff finds it
    for (const ring of freshRings(read.rows, Date.now() / 1000)) await ringInApp(ring);
    // A message or a ring is on chain, so the backend may be back: cut the backoff short and try it now.
    if (!signal.aborted) session.interrupt?.abort();
  }
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
  return { key, mayorKey: state.mayorKey, direct: hasFeature('direct'), offline: state.status === 'offline', onUnreachable: noteBackendUnreachable };
}

/** A call to the backend got no answer (it timed out, or the connection failed): whatever the stream last said, the
 * line is not live. It reads reconnecting at once and a new stream is tried. */
export function noteBackendUnreachable(): void {
  if (!current || state.status !== 'live') return;
  setState({ status: 'reconnecting', error: 'The backend did not answer.' });
  current.interrupt?.abort();
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
    let viewFetched = false;
    if (what.messages) {
      try {
        const synced = await syncMessagesAndEvents({ publicKeyHex: publicKeyHexFromMasterKey(key), unlockedKey: key, mayorKey: state.mayorKey, live: hasFeature('view') });
        if (synced.applied > 0) lastProjected = Date.now();
        viewFetched = synced.refetched;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (what.view && !viewFetched) {
      try {
        await refreshView({ key, mayorKey: state.mayorKey, live: hasFeature('view') });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    ok = errors.length === 0;
    const syncs = what.messages ? state.syncs + 1 : state.syncs;
    if (ok) setState({ lastHeard: Date.now(), error: undefined, syncs });
    else setState({ error: errors.join('; '), syncs });
  });
  return ok;
}

/** The stream says the view changed. Before any events batch this session it is fetched
 * at once, as ever; once events flow, the batch that follows within VIEW_GRACE_MS has
 * already changed the stored copy, and the view is fetched only if none does. */
function onViewEvent(key: Uint8Array): void {
  if (lastProjected === 0) {
    void syncAll(key, { view: true });
    return;
  }
  if (viewWait !== undefined) return;
  const heard = Date.now();
  viewWait = setTimeout(() => {
    viewWait = undefined;
    if (current?.key === key && lastProjected < heard - VIEW_GRACE_MS) void syncAll(key, { view: true });
  }, VIEW_GRACE_MS);
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
  // A link that dies without a word never ends the stream: when it has pinged nothing for STREAM_STALE_MS
  // (and the page is on screen, where timers run true) the stream is given up on and read as dropped.
  let heard = Date.now();
  let quiet = false;
  let watch: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (typeof document !== 'undefined' && document.hidden) heard = Date.now(); // a page nobody is looking at is judged when it comes back (onForeground)
    if (Date.now() - heard > STREAM_STALE_MS) {
      quiet = true;
      void reader.cancel().catch(() => {});
      return;
    }
    watch = setTimeout(check, STALE_CHECK_MS);
  };
  watch = setTimeout(check, STALE_CHECK_MS);
  try {
    await readStream(reader, key, () => {
      heard = Date.now();
    });
  } catch (err) {
    if (!quiet) throw err;
  } finally {
    clearTimeout(watch);
  }
  if (quiet) throw new Error('The event stream went quiet.');
}

async function readStream(reader: ReadableStreamDefaultReader<string>, key: Uint8Array, heardNow: () => void): Promise<void> {
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    heardNow();
    buffer += value.replace(/\r\n/g, '\n');
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const parsed = parseEventBlock(block);
      setState({ lastHeard: Date.now() });
      if (parsed?.event === 'hello') void syncAll(key, { messages: true, view: true });
      else if (parsed?.event === 'message') void syncAll(key, { messages: true });
      else if (parsed?.event === 'view') onViewEvent(key);
      split = buffer.indexOf('\n\n');
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

async function run(key: Uint8Array, signal: AbortSignal): Promise<void> {
  const session = current;
  setState({ status: 'connecting', error: undefined });
  let me: Me = LEGACY;
  // Whether the backend has said who is who (§15) this session. Until it has, the phone knows no
  // stream and no direct road, so every turn of the loop asks again: a backend that did not answer
  // when the app opened is found the moment it does, not at the next restart (mw-gq6.276).
  let known = false;
  /** Asks /api/me; false when the key holds no licence or live was stopped, and the loop must stop. */
  const learnMe = async (): Promise<boolean> => {
    try {
      me = await fetchMe({ key });
      known = true;
    } catch (err) {
      if (signal.aborted) return false;
      if (err instanceof NoLicenceError) {
        setState({ status: 'unlicensed', me: null, error: err.message });
        return false;
      }
      setState({ status: 'offline', error: err instanceof Error ? err.message : String(err) });
    }
    if (signal.aborted) return false;
    const keys = await reconcileMayorKey(me.mayor);
    setState({ me, mayorKey: keys.pinned, offeredMayorKey: keys.offered });
    return true;
  };
  if (!(await learnMe())) return;
  await syncAll(key, { messages: true, view: true });

  let backoff = 1000;
  // Whether the sync after the last stream error failed too: only then, with the
  // next reconnect failing as well, is the backend really unreachable.
  let recoverySyncFailed = false;
  while (!signal.aborted) {
    // Aborted to cut a stream or a backoff short when the app returns to the foreground.
    const interrupt = new AbortController();
    if (session) session.interrupt = interrupt;
    const wake = AbortSignal.any([signal, interrupt.signal]);
    if (!known && !(await learnMe())) return;
    if (me.features.includes('events')) {
      try {
        await listen(key, wake);
        backoff = 1000;
        recoverySyncFailed = false;
      } catch (err) {
        if (signal.aborted) return;
        if (interrupt.signal.aborted) {
          // The foreground refresh already pulled everything: reconnect at once.
          setState({ status: 'reconnecting' });
          backoff = 1000;
          continue;
        }
        // A dropped stream is usually a blip (a suspended phone, a network
        // change): say 'reconnecting', and 'offline' only once a reconnect and
        // the sync after the drop have both failed.
        setState({ status: recoverySyncFailed ? 'offline' : 'reconnecting', error: err instanceof Error ? err.message : String(err) });
      }
      await sleep(backoff, wake);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      if (!signal.aborted) recoverySyncFailed = !(await syncAll(key, { messages: true, view: true }));
    } else {
      setState({ status: state.error ? 'offline' : 'polling' });
      // Not yet told who is who: ask again soon, backing off as a dropped stream does.
      await sleep(known ? POLL_MS : backoff, wake);
      if (!known) backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
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
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') window.addEventListener('pageshow', onForeground);
  void run(key, abort.signal);
}

export function stopLive(): void {
  current?.abort.abort();
  current = null;
  chainSeen.clear();
  lastForeground = 0;
  lastProjected = 0;
  clearTimeout(viewWait);
  viewWait = undefined;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') window.removeEventListener('pageshow', onForeground);
  setState({ status: 'idle' });
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') onForeground();
}

/** Whether the stream has stopped talking: an error state, or silence past the pings. */
function streamIsDead(): boolean {
  if (!state.me?.features.includes('events')) return false;
  if (state.status === 'reconnecting' || state.status === 'offline') return true;
  return state.status === 'live' && Date.now() - (state.lastHeard ?? 0) > STREAM_STALE_MS;
}

/** The app is back on screen (visible again, or restored from the bfcache): the OS
 * may have suspended the stream and swallowed `view` events, so pull everything
 * now and, if the stream is dead, open a new one at once. */
function onForeground(): void {
  if (!current) return;
  const now = Date.now();
  if (now - lastForeground < FOREGROUND_DEBOUNCE_MS) return;
  lastForeground = now;
  if (streamIsDead()) current.interrupt?.abort();
  void refreshNow();
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
