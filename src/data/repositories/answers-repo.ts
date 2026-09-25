import { db, type AnswerRow } from '../db';

export const answersRepo = {
  async get(bead: string): Promise<AnswerRow | undefined> {
    return db.answers.get(bead);
  },

  /** Stamps `ts` at write time — the moment the reply's txid is known, not when
   * the component that called this happened to render. */
  async save(row: Omit<AnswerRow, 'ts'>): Promise<void> {
    await db.answers.put({ ...row, ts: Math.floor(Date.now() / 1000) });
  },

  /** Every bead id already answered — Needs you filters these out at once,
   * rather than waiting for the snapshot's next tick to catch up. */
  async answeredBeadIds(): Promise<Set<string>> {
    const rows = await db.answers.toArray();
    return new Set(rows.map((row) => row.bead));
  },
};
