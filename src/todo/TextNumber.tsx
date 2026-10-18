// src/todo/TextNumber.tsx — under a card's Text: line that names someone and no number (mw-ev7oyy.35): the reason the home wrote
// ('two contacts match Matthew') and one field, "Add Matthew's number". The number goes to the home as a todo_edit whose notes carry it
// in the line (withTextNumber), the way every other edit of the board reaches it; the home keeps the notes, so the number stays on the
// card and from then the Text button opens Voice to it. Postern holds no address book and sends no text.
import { useState } from 'react';
import { Button } from '../ui';
import { parsePhoneNumber, parseTextAction, textNumberLabel, withTextNumber, type TextAction } from './links';
import type { TodoCard } from './lists';
import type { TodoStore } from './store';

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

export function TextNumber({ store, card, text }: { store: TodoStore; card: TodoCard; text: TextAction & { name: string } }) {
  const back = store.useBack(card.id);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string>();
  // an edit of his that carries the number is waiting for the home (the store shows its notes at once): the field is spent until the home answers or refuses it
  const waiting = back.status === 'ready' ? parseTextAction(back.description)?.number : undefined;
  const label = textNumberLabel(text);
  const ready = back.status === 'ready';

  const save = () => {
    const parsed = parsePhoneNumber(typed);
    if ('problem' in parsed) {
      setProblem(parsed.problem);
      return;
    }
    const notes = withTextNumber(back.description, parsed.number);
    if (notes === undefined) {
      setProblem('The Text: line is not in the notes any more');
      return;
    }
    setProblem(undefined);
    void store.edit(card.id, { notes });
  };

  return (
    <div data-nodrag data-testid="text-number" className="mt-1.5 flex flex-col gap-1.5">
      {text.reason && <p className="text-[12px] leading-snug text-muted wrap-anywhere">{capital(text.reason)}</p>}
      {waiting ? (
        <p role="status" className="text-[12.5px] text-muted">
          {`Saving ${text.name}'s number, waiting for the Mayor`}
        </p>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && typed.trim()) save();
          }}
        >
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
              {label}
              <input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+1 555 123 0001"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setProblem(undefined);
                }}
                className="h-9 w-full text-[14px] text-text"
              />
            </label>
            <Button size="sm" variant="secondary" icon="save" type="submit" disabled={!ready || !typed.trim()}>
              Save number
            </Button>
          </div>
          {back.status === 'loading' && <p className="text-[12px] text-muted">Loading the notes…</p>}
          {(back.status === 'error' || back.status === 'missing') && <p className="text-[12px] text-muted">The notes could not be loaded, so the number cannot be saved now.</p>}
          {problem && (
            <p role="alert" className="text-[12.5px] text-danger">
              {problem}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
