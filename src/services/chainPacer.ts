// src/services/chainPacer.ts — the one queue every WhatsOnChain read on the Key screen waits in.
// Its free tier answers about 3 requests a second per IP, and a 429 carries no CORS header, so
// the phone cannot tell it from being offline. Each read used to build its own provider, which
// paced only its own calls, and the history pages bypassed any pacing: the licence check and the
// Issued licences list ran side by side at twice the limit. Now a request leaves only once the
// gap since the last request, from any caller, has passed (docs/key-screen-reads.md). The gap is
// measured on the monotonic clock: the wall clock can step (a WSL2 resync, an NTP jump).

/** The least time between the starts of two requests to WhatsOnChain (about 2.9 a second). */
export const CHAIN_READ_GAP_MS = 350;

let gapMs = CHAIN_READ_GAP_MS;
let lastStart = -Infinity;
let queue: Promise<void> = Promise.resolve();

/** Tests set the gap to 0 (and one test to a few ms to measure it). */
export function setChainReadGapMs(ms: number): void {
  gapMs = ms;
}

/** Forgets the last request, for a test that starts clean. */
export function resetChainPacer(): void {
  lastStart = -Infinity;
  queue = Promise.resolve();
}

/** Runs `call` once the gap since the previous request has passed; calls leave in the order they ask. */
export function paced<T>(call: () => Promise<T>): Promise<T> {
  const turn = queue.then(async () => {
    // A timer can fire a hair early: wait again until the whole gap has really passed.
    for (let wait = lastStart + gapMs - performance.now(); wait > 0; wait = lastStart + gapMs - performance.now()) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    lastStart = performance.now();
  });
  queue = turn;
  return turn.then(call);
}
