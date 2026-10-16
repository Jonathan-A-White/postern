// What a promise that settles after a test's page is torn down meets (mw-ev7oyy.21): vitest removes jsdom's
// globals at the end of a test file, and a React setState that runs then throws 'window is not defined' as an
// unhandled rejection that fails a green run. settleAfterTeardown takes `window` away as teardown does, runs
// `settle` (resolving or rejecting the reads a closed screen started), lets their callbacks run, puts `window`
// back, and returns every unhandled rejection or uncaught error they raised: none, for a screen that drops
// what answers after it has closed.
export async function settleAfterTeardown(settle: () => void): Promise<unknown[]> {
  const raised: unknown[] = [];
  const record = (reason: unknown) => raised.push(reason);
  process.on('unhandledRejection', record);
  process.on('uncaughtException', record);
  // React's own work from closing the screen (its passive effects) runs on the next macrotask: let it finish first.
  await new Promise((resolve) => setImmediate(resolve));
  const window = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    delete (globalThis as { window?: unknown }).window;
    settle();
    // A rejection is reported once the microtasks are drained, before the next macrotask.
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (window) Object.defineProperty(globalThis, 'window', window);
    process.off('unhandledRejection', record);
    process.off('uncaughtException', record);
  }
  return raised;
}

/** A promise the test settles by hand. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
