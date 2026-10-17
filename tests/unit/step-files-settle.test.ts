import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// mw-gq6.557 (after mw-gq6.544): a step file that runs the real outbox starts each scenario by clearing Dexie.
// The last scenario's sender and its write-behinds (the answer save, the Recorded note, the sent record) must
// settle first, with settlePhone() or emptyPhone() (settledOutbox() alone where a scenario holds a write open for ever), or one lands after the clear and shows in the next scenario.
const STEPS = join(__dirname, '..', '..', 'features', 'steps');
const SETTLES = /\b(settlePhone|emptyPhone|settledOutbox)\(\)/;
const CLEARS = /\bdb\.\w+\.clear\(\)|\bforgetOutboxState\(\);/;
const RUNS_THE_REAL_OUTBOX = /import\s*\{[^}]*\b(forgetOutboxState|startOutbox|kickOutbox|enqueue)\b[^}]*\}\s*from\s*'[^']*services\/outbox'/;

describe('step files that run the real outbox', () => {
  const files = readdirSync(STEPS).filter((name) => /\.steps\.tsx?$/.test(name));
  const real = files.filter((name) => RUNS_THE_REAL_OUTBOX.test(readFileSync(join(STEPS, name), 'utf8')));

  it('are found', () => {
    expect(real.length).toBeGreaterThan(10);
  });

  it('settle the phone before the first clear', () => {
    const unsettled = real.filter((name) => {
      const text = readFileSync(join(STEPS, name), 'utf8');
      const clear = text.search(CLEARS);
      const settle = text.search(SETTLES);
      return clear >= 0 && (settle < 0 || settle > clear);
    });
    expect(unsettled).toEqual([]);
  });
});
