// tests/support/phone-cursor.ts — fake-indexeddb at the pace of his phone (mw-gq6.712). Every step of a cursor on
// the phone is a round trip to Chrome's database process, and he holds every factory event since mw-jrx0s.7: a read
// that walks the whole events table took long enough there that a tapped banner stayed. fake-indexeddb steps in
// microseconds, which hid it; this stalls each step for `ms` (Atomics.wait, so the transaction stays active).

const stall = new Int32Array(new SharedArrayBuffer(4));

/** Slows every cursor step to `ms`; returns what puts the fake's own pace back. */
export function phonePaceCursors(ms: number): () => void {
  const proto = globalThis.IDBCursor.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'continue');
  const step = proto.continue;
  proto.continue = function (this: IDBCursor, key?: IDBValidKey) {
    Atomics.wait(stall, 0, 0, ms);
    return step.call(this, key);
  };
  return () => {
    if (own) Object.defineProperty(proto, 'continue', own);
  };
}
