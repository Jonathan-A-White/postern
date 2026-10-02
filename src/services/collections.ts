// src/services/collections.ts — the collection names Postern mints and reads licences in.

/** The cockpit's own collection: Me's mint goes here, and the gate counts a mint in it. */
export const COCKPIT_COLLECTION = 'postern';

/** The collection spell-forge-bsv's chainConfig defaults to, where his first mint went.
 * mw-6ww.63 is the transition: the gate still counts it so his phone is not locked out
 * before he re-mints in 'postern'; remove this once he has. */
export const LEGACY_LICENCE_COLLECTION = 'spellforge-leaderboard-testnet';
