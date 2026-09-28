// src/cockpit/remembered.ts — whether a one-tap action he has already sent is
// still newer than the view a screen is showing. send.ts remembers each action
// in answersRepo; until the view republishes (docs/protocol.md §11) the screen
// must not offer the same tap again, and once a newer view is published the
// view is the truth again (he may have been held a second time).
import type { AnswerRow } from '../data/db';

export function actionRemembered(answers: AnswerRow[], bead: string, action: string, viewWrittenAt: string | undefined): boolean {
  const row = answers.find((candidate) => candidate.bead === bead);
  if (!row || row.answer !== action) return false;
  const published = Date.parse(viewWrittenAt ?? '');
  return Number.isNaN(published) || row.ts * 1000 > published;
}
