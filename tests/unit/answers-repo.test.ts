import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { answersRepo } from '../../src/data/repositories';

describe('answersRepo', () => {
  beforeEach(async () => {
    await db.answers.clear();
  });

  it('returns undefined for a bead never answered', async () => {
    expect(await answersRepo.get('mw-abcd1.2')).toBeUndefined();
  });

  it('round-trips a saved answer, stamping ts at write time', async () => {
    const before = Math.floor(Date.now() / 1000);
    await answersRepo.save({ bead: 'mw-abcd1.2', answer: 'ship', txid: 'a'.repeat(64) });
    const row = await answersRepo.get('mw-abcd1.2');
    expect(row?.answer).toBe('ship');
    expect(row?.txid).toBe('a'.repeat(64));
    expect(row?.ts).toBeGreaterThanOrEqual(before);
  });

  it('collects every answered bead id', async () => {
    await answersRepo.save({ bead: 'mw-abcd1.1', answer: 'ship', txid: 'a'.repeat(64) });
    await answersRepo.save({ bead: 'mw-abcd1.2', answer: 'wait', txid: 'b'.repeat(64) });
    expect(await answersRepo.answeredBeadIds()).toEqual(new Set(['mw-abcd1.1', 'mw-abcd1.2']));
  });
});
