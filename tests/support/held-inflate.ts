// tests/support/held-inflate.ts — the view's inflate on a fake clock (mw-ev7oyy.18). gunzip's DecompressionStream is
// zlib on libuv's thread pool: the one piece of the live loop that takes real time, which a fake clock cannot move and no
// count of the event loop's turns outlasts. On the laptop at load 32 it came back after the clock had been moved on, so
// the stream opened late, its hello was lost and a later sync asked for the start's view again. holdInflates() keeps
// every inflate (its real zlib run through) until the test lets it go with the clock still; settle() does that and waits
// for it to be back. So an inflate never ends at a time the host's load decides, and a step that does not wait for one
// fails on every run, not only on a loaded host. countInflates() is the same without the hold.
import { vi } from 'vitest';

/** Every inflate begun and not yet back: let it go, and when it is back. */
const out = new Set<{ release: () => void; back: Promise<void> }>();

class HeldDecompressionStream {
  readonly writable: WritableStream<BufferSource>;
  readonly readable: ReadableStream<Uint8Array>;

  constructor(format: CompressionFormat, Real: typeof DecompressionStream, hold: boolean) {
    const real = new Real(format);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (!hold) release();
    let back!: () => void;
    const inflate = { release, back: new Promise<void>((resolve) => (back = resolve)) };
    out.add(inflate);
    const done = () => {
      out.delete(inflate);
      back();
    };
    this.writable = real.writable;
    this.readable = real.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: () => released.then(done) }));
  }
}

function stubInflate(hold: boolean): void {
  const Real = globalThis.DecompressionStream;
  vi.stubGlobal(
    'DecompressionStream',
    class extends HeldDecompressionStream {
      constructor(format: CompressionFormat) {
        super(format, Real, hold);
      }
    },
  );
}

/** From now until vi.unstubAllGlobals(), every inflate waits to be let go (letInflatesGo, settle). */
export function holdInflates(): void {
  stubInflate(true);
}

/** For a test that awaits a fetch of the view itself, which a held inflate would never end: every inflate goes at once,
 * but is counted until it is back, so letInflatesGo and settle still wait for the ones nobody awaits (a trailing fetch). */
export function countInflates(): void {
  stubInflate(false);
}

/** Lets every inflate out go and waits until each is back; resolves whether there were any. */
export async function letInflatesGo(): Promise<boolean> {
  const now = [...out];
  for (const inflate of now) inflate.release();
  await Promise.all(now.map((inflate) => inflate.back));
  return now.length > 0;
}

/** With the clock still: lets every inflate go and waits until it is back, and lets IndexedDB (which answers on the real
 * setImmediate) catch up, until `turns` turns pass with no inflate begun. It waits on the work, never on a deadline. */
export async function settle(turns = 20): Promise<void> {
  for (let quiet = 0; quiet < turns; ) {
    if (await letInflatesGo()) quiet = 0;
    else {
      await new Promise<void>((resolve) => setImmediate(resolve));
      quiet += 1;
    }
  }
}
