// src/cockpit/remembered.ts — whether a one-tap action he has already sent is
// still waiting for the factory. send.ts remembers each action in answersRepo
// with the seq of the view he tapped against; the host echoes an applied action
// as an event naming its txid (docs/protocol.md §13). While the view carries a
// seq the tap waits until that seq has reached the echo's: no clock is compared.
// A view with no seq (an older mw) keeps the clock rule, the phone's time of the
// tap against the view's written_at. Once the view has passed the tap it is the
// truth again (he may have been held a second time).
import type { AnswerRow } from '../data/db';

/** What the view on screen says of itself: when the host wrote it, and its place in the event order. */
export interface ViewStamp {
  writtenAt: string | undefined;
  seq: number | undefined;
}

function rowOf(answers: AnswerRow[], bead: string, action: string): AnswerRow | undefined {
  const row = answers.find((candidate) => candidate.bead === bead);
  return row && row.answer === action ? row : undefined;
}

/** The txid of the remembered tap of `action` on `bead`, whose echo event the caller looks for. */
export function rememberedTxid(answers: AnswerRow[], bead: string, action: string): string | undefined {
  return rowOf(answers, bead, action)?.txid;
}

/** `echoSeq` is the seq of the event that echoed the remembered tap's txid, undefined while none has arrived. */
export function actionRemembered(answers: AnswerRow[], bead: string, action: string, view: ViewStamp, echoSeq?: number): boolean {
  const row = rowOf(answers, bead, action);
  if (!row) return false;
  if (view.seq !== undefined && row.viewSeq !== undefined) return echoSeq === undefined || view.seq < echoSeq;
  const published = Date.parse(view.writtenAt ?? '');
  return Number.isNaN(published) || row.ts * 1000 > published;
}
