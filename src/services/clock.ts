// src/services/clock.ts — the time, read through one function so a screen can ask
// for it from a handler (the react-hooks purity rule rejects Date.now() in a
// component) and a test can set it.
export function now(): number {
  return Date.now();
}
