// src/key/issuedDates.ts — when this phone issued each licence. The chain history the
// Issued licences list is read from carries block heights, not times, so the date of a
// licence issued from this phone is kept here, by txid, in the settings table.
import { settingsRepo } from '../data/repositories';

const KEY = 'issuedLicenceTimes';

type Times = Record<string, number>;

export async function issuedTimes(): Promise<Times> {
  return ((await settingsRepo.get(KEY)) as Times | undefined) ?? {};
}

/** Notes that `txid` was issued now. */
export async function rememberIssuedAt(txid: string): Promise<void> {
  await settingsRepo.set(KEY, { ...(await issuedTimes()), [txid]: Date.now() });
}
