// src/todo/TodoBoard.tsx — the To do board (mw-ev7oyy.4): his own outside things, a column per list
// (side by side on a wide screen, one column per screen width to swipe across on a phone), a card per
// item. A tap on a card turns it over to its back (its notes, its comments, the beads it names); Done
// asks for the card to be closed and the card stays, greyed, until the view drops it. Draws only what
// a TodoStore gives it.
import { useState } from 'react';
import { Button, Chip, EmptyState, Icon, Spinner, cx } from '../ui';
import { Markdown } from '../markdown/Markdown';
import { beadHref } from '../nav/route';
import { beadsNamed, type TodoCard, type TodoList } from './lists';
import { usePosternTodoStore } from './posternStore';
import type { TodoDone, TodoStore } from './store';

function DoneControl({ state: { waiting, note, done } }: { state: TodoDone }) {
  if (note) return <div className="mt-2">{note}</div>;
  if (waiting) {
    return (
      <span role="status" className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted">
        <Icon name="clock" size={15} />
        Done, waiting for the Mayor
      </span>
    );
  }
  return (
    <div className="mt-2">
      <Button size="sm" variant="secondary" icon="check" onClick={done}>
        Done
      </Button>
    </div>
  );
}

function CardBack({ store, card, onBack }: { store: TodoStore; card: TodoCard; onBack: () => void }) {
  const back = store.useBack(card.id);
  const named = beadsNamed(card.id, [back.description, ...back.comments.map((comment) => comment.text)]);
  return (
    <div role="group" aria-label={`Back of ${card.title}`} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Button size="sm" variant="ghost" icon="back" onClick={onBack}>
          Back
        </Button>
        <a href={beadHref(card.id)} className="ml-auto self-center text-[12.5px] text-muted underline">
          Open {card.id}
        </a>
      </div>
      <p className="text-[15px] leading-snug font-semibold wrap-anywhere">{card.title}</p>
      {back.status === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner size={16} />
          Loading the notes…
        </div>
      )}
      {back.status === 'error' && <p className="text-[13px] text-danger">The notes could not be fetched. Turn the card over again to retry.</p>}
      {back.status === 'missing' && <p className="text-[13px] text-muted">The notes are not available.</p>}
      {back.status === 'ready' && (back.description.trim() ? <Markdown text={back.description} wrap /> : <p className="text-[13px] text-muted">No notes.</p>)}
      {back.comments.length > 0 && (
        <section aria-label="Comments" className="flex flex-col gap-2 border-t border-line pt-2">
          {back.comments.map((comment) => (
            <div key={`${comment.at}|${comment.author}|${comment.text}`} className="text-[13.5px]">
              <p className="text-[12px] text-faint">{comment.author}</p>
              <Markdown text={comment.text} wrap />
            </div>
          ))}
        </section>
      )}
      {named.length > 0 && (
        <section aria-label="Beads named" className="flex flex-wrap gap-1.5 border-t border-line pt-2">
          {named.map((id) => (
            <a key={id} href={beadHref(id)} className="flex max-w-full items-center gap-1.5 text-[13px]">
              <Chip mono icon="link">
                {id}
              </Chip>
              {store.titleOf(id) && <span className="min-w-0 truncate">{store.titleOf(id)}</span>}
            </a>
          ))}
        </section>
      )}
    </div>
  );
}

function Card({ store, card }: { store: TodoStore; card: TodoCard }) {
  const [over, setOver] = useState(false);
  const state = store.useDone(card.id);
  return (
    <li data-testid="todo-card" className={cx('rounded-xl border border-line bg-surface p-3', state.waiting && !over && 'opacity-60')}>
      {over ? (
        <CardBack store={store} card={card} onBack={() => setOver(false)} />
      ) : (
        <>
          <button type="button" title="Turn the card over" onClick={() => setOver(true)} className="flex w-full items-start gap-2 text-left text-[15px] leading-snug font-medium wrap-anywhere">
            <span className="min-w-0 flex-1">{card.title}</span>
            <Icon name="forward" size={16} className="mt-0.5 shrink-0 text-faint" />
          </button>
          <DoneControl state={state} />
        </>
      )}
      {over && <DoneControl state={state} />}
    </li>
  );
}

function Column({ store, list }: { store: TodoStore; list: TodoList }) {
  return (
    <section aria-label={list.title} className="flex max-h-full min-h-0 w-full shrink-0 snap-start flex-col rounded-2xl border border-line bg-canvas lg:w-80">
      <header className="flex shrink-0 items-baseline gap-2 px-3 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold wrap-anywhere">{list.epic ? <a href={beadHref(list.epic)}>{list.title}</a> : list.title}</h2>
        <span className="rounded-full bg-raised px-2 text-[11px] text-muted tabular-nums">{list.cards.length}</span>
      </header>
      <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {list.cards.map((card) => (
          <Card key={card.id} store={store} card={card} />
        ))}
      </ul>
    </section>
  );
}

/** The board over any store. */
export function Board({ store }: { store: TodoStore }) {
  const lists = store.lists;
  if (!lists) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner size={22} />
      </div>
    );
  }
  if (lists.length === 0) return <EmptyState icon="check" title="Nothing on your lists." />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lists.length > 1 && <p className="shrink-0 px-4 pt-2 text-[12px] text-faint lg:hidden">Swipe sideways for the next list.</p>}
      <div className="scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto p-4">
        {lists.map((list) => (
          <Column key={list.id} store={store} list={list} />
        ))}
      </div>
    </div>
  );
}

/** The board over the Postern view. */
export function TodoBoard() {
  return <Board store={usePosternTodoStore()} />;
}
