// src/todo/RefusedNote.tsx — the line a To do change leaves when the Mayor's side did not apply it
// (mw-ev7oyy.7): the card is back as it was, and this says what was asked.
import { Button } from '../ui';

export function RefusedNote({ words, onDismiss }: { words: string; onDismiss: () => void }) {
  return (
    <span data-testid="refused-note" role="alert" className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-danger">
      <span className="min-w-0 wrap-anywhere">{words} was not done: the Mayor did not apply it. The board is as it was.</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </span>
  );
}
