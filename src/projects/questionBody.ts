// src/projects/questionBody.ts — mw-tfne4.5: the Question screen's body for a
// Needs you row, matched by bead id against an already-synced decision-needed
// message when one exists (the fuller original text), falling back to the
// snapshot's own needs_you fields (title, recommended, options) when it doesn't.
import { messagesRepo } from '../data/repositories';
import { decodeQuestion, type QuestionBody, type SnapshotNeedsYou } from '../services/questions';

export async function resolveQuestionBody(item: SnapshotNeedsYou): Promise<QuestionBody> {
  const messages = await messagesRepo.getAll();
  for (const row of messages) {
    if (row.class !== 'decision-needed' || row.plaintext === undefined) continue;
    const decoded = decodeQuestion(row.plaintext);
    if (decoded && decoded.bead === item.id) return decoded;
  }
  return { bead: item.id, q: item.title, rec: item.recommended, options: item.options };
}
