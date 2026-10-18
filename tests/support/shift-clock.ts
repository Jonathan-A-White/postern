/**
 * Moves the real clock by TEST_CLOCK_OFFSET_MS (set by tests/global-setup.ts from TEST_CLOCK_AT): Date.now()
 * and new Date() read that much later or earlier than the host, and keep ticking. It exists so a test run can
 * start at 23:59:50 and cross midnight, which is when a time shown as "11:56 PM" turns into "Sat 11:56 PM"
 * (mw-ev7oyy.44). Without the variable it changes nothing. A test that freezes Date (freeze-clock.ts) replaces
 * this and restores it after.
 */
const offset = Number(process.env.TEST_CLOCK_OFFSET_MS ?? 0);

if (offset !== 0 && !Number.isNaN(offset)) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
