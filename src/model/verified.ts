// src/model/verified.ts — the words the Verified button sends (mw-581qad.1). The Verify word is the
// first word of a channel message; the rest says where he tapped, so the Mayor can tell a tap in
// Needs you from one on the bead's page or under HOW TO CHECK IT in the channel.

/** Where Verified was tapped, as the words that follow "tapped Verified". */
export const VERIFIED_SOURCES = {
  needs: 'in Needs you',
  page: "on <bead>'s page",
  channel: "under HOW TO CHECK IT in <bead>'s channel",
};

export type VerifiedWhere = keyof typeof VERIFIED_SOURCES;

/** The channel message a Verified tap sends: VERIFIED first, no leading text. */
export function verifiedWords(bead: string, where: VerifiedWhere): string {
  return `VERIFIED (tapped Verified ${VERIFIED_SOURCES[where].replaceAll('<bead>', bead)})`;
}

/** The marker millwright puts above the steps it writes for him (application/posternview.go). */
export const HOW_TO_CHECK_IT = 'HOW TO CHECK IT';

/** The id of the newest item whose text carries HOW TO CHECK IT, whoever wrote it: the Mayor's post, or a Builder's closing comment when the Mayor did not post. */
export function howToCheckItemId(items: { id: string; at: number; text: string }[]): string | undefined {
  let newest: { id: string; at: number } | undefined;
  for (const item of items) {
    if (!item.text.includes(HOW_TO_CHECK_IT)) continue;
    if (!newest || item.at >= newest.at) newest = item;
  }
  return newest?.id;
}
