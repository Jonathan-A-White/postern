// scripts/shots-retries.mjs — mw-6ww.175.61: the pure parts of the last line of `npm run shots`, which says how many tests
// were run again because their page's target detached during setup (tests/support/detached-retries-reporter.ts writes one
// line per such test into the file named by SHOTS_RETRIES_FILE; scripts/run-shots.mjs reads it after each size's run).

/** How many tests the reporter's file names: one per non-empty line. */
export function countRetried(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/** The last line of a shots run: the total, and each size that had any. counts: [{ size, retried }]. */
export function retriedLine(counts) {
  const total = counts.reduce((sum, c) => sum + c.retried, 0);
  const noun = total === 1 ? 'test' : 'tests';
  const where = counts.filter((c) => c.retried > 0).map((c) => `${c.size}: ${c.retried}`);
  return `shots: ${total} ${noun} retried for a detached page${where.length > 0 ? ` (${where.join(', ')})` : ''}`;
}
