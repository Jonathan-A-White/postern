// src/todo/TodoBoard.tsx — the To do board (mw-ev7oyy.4): his own outside things, a column per list
// (side by side on a wide screen, one column per screen width to swipe across on a phone), a card per
// item. A tap on a card turns it over to its back (its notes, its comments, the beads it names, Edit
// and the keyboard's way to move it); Done asks for the card to be closed and the card stays, greyed,
// until the view drops it. A card is dragged (held, on a phone) to reorder it or move it to another
// list; each list ends in 'Add a card'. A card with a due time shows it on its face (red once past), its back sets or
// clears it with a date-time input, and a list's menu sorts its cards by due (mw-ev7oyy.9). Every change shows at once, marked pending, until the view agrees
// (mw-ev7oyy.7). A card whose notes have an 'Open:' line shows a chip per link under its title, a tap opening the
// link and nothing else (mw-ev7oyy.12; links.ts says what each is). Draws only what a TodoStore gives it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Chip, EmptyState, Icon, IconButton, Spinner, cx } from '../ui';
import { useNow } from '../ui/useNow';
import { focusOnMount } from '../ui/focus';
import { Markdown } from '../markdown/Markdown';
import { beadHref } from '../nav/route';
import { dueToInput, formatDue, inputToDue, isPastDue, sortByDue } from './due';
import { moveFor } from './edits';
import { linkProps, parseOpenLinks, type OpenLink } from './links';
import { beadsNamed, type TodoCard, type TodoList } from './lists';
import { usePosternTodoStore } from './posternStore';
import type { TodoDone, TodoStore } from './store';
import { useCardDrag, type DragState } from './useDrag';

/** Where a card stands on the board, for the ways of moving it. */
interface Place {
  lists: TodoList[];
  list: TodoList;
  index: number;
  /** The list is shown sorted by due, so a card's place in it is not its place in his order. */
  sorted: boolean;
}

/** How often a due time is read against the clock again, to turn red the minute it passes. */
const DUE_LOOK_MS = 30_000;

function PendingMark() {
  return (
    <span data-testid="pending-mark" className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[11px] font-medium text-muted">
      <Icon name="clock" size={11} />
      pending
    </span>
  );
}

/** The due time on a card's face: red, with 'Past due' for a screen reader, once it has passed. */
function DueLine({ due }: { due: string }) {
  const now = useNow(DUE_LOOK_MS);
  const past = isPastDue(due, now);
  return (
    <p data-testid="due" data-past={past} className={cx('mt-1 flex items-center gap-1 text-[13px]', past ? 'font-medium text-danger' : 'text-muted')}>
      <Icon name="clock" size={13} />
      {past && <span className="sr-only">Past due: </span>}
      {formatDue(due, now)}
    </p>
  );
}

/** The Due field of a card's back: a date-time input, Set due (dead until a different, whole time is picked) and Clear due (only when the card has one). */
function DueField({ card, onSet }: { card: TodoCard; onSet: (due: string) => void }) {
  const current = dueToInput(card.due);
  const [value, setValue] = useState(current);
  const picked = inputToDue(value);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (picked && value !== current) onSet(picked);
      }}
    >
      <label className="flex min-w-0 flex-col gap-1 text-[12.5px] text-muted">
        Due
        <input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} className="h-10 text-[14px] text-text" />
      </label>
      <Button size="sm" variant="secondary" type="submit" disabled={!picked || value === current}>
        Set due
      </Button>
      {card.due && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue('');
            onSet('');
          }}
        >
          Clear due
        </Button>
      )}
    </form>
  );
}

/** A card's links as chips under its title: each an anchor that opens the app it names (links.ts says how), named 'Open in <its text>' for a screen reader. */
function LinkChips({ links }: { links: OpenLink[] }) {
  if (links.length === 0) return null;
  return (
    <div data-nodrag data-testid="card-links" className="mt-1.5 flex flex-wrap gap-1.5">
      {links.map((link, at) => (
        <a
          key={`${at}|${link.url}`}
          {...linkProps(link)}
          aria-label={`Open in ${link.text}`}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-line px-2 text-[12px] text-muted no-underline"
        >
          <Icon name="link" size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{link.text}</span>
        </a>
      ))}
    </div>
  );
}

/** The chips of a card whose view summary may be cut short: the whole notes, once the store has them, decide (the summary's links stand in until then). */
function FullNotesChips({ store, card }: { store: TodoStore; card: TodoCard }) {
  const back = store.useBack(card.id);
  return <LinkChips links={back.status === 'ready' ? parseOpenLinks(back.description) : (card.links ?? [])} />;
}

function CardLinks({ store, card }: { store: TodoStore; card: TodoCard }) {
  return card.summaryCut ? <FullNotesChips store={store} card={card} /> : <LinkChips links={card.links ?? []} />;
}

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

function EditCard({ card, notes, notesKnown, onSave, onCancel }: { card: TodoCard; notes: string; notesKnown: boolean; onSave: (change: { title?: string; notes?: string }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(notes);
  const trimmed = title.trim();
  const change = { ...(trimmed !== card.title ? { title: trimmed } : {}), ...(notesKnown && text !== notes ? { notes: text } : {}) };
  const changed = Object.keys(change).length > 0;
  return (
    <form
      aria-label={`Edit ${card.title}`}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && changed) onSave(change);
      }}
    >
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="h-10 w-full text-[15px] text-text" ref={focusOnMount} />
      </label>
      {notesKnown ? (
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Notes
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} className="w-full text-[14px] text-text" />
        </label>
      ) : (
        <p className="text-[12.5px] text-muted">The notes could not be loaded, so only the title can be changed now.</p>
      )}
      {!trimmed && <p className="text-[12.5px] text-danger">A card needs a title.</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon="save" type="submit" disabled={!trimmed || !changed}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The keyboard's way to move a card (and a screen reader's): one step up or down its list, or to the foot of another list. */
function MoveControls({ store, card, place }: { store: TodoStore; card: TodoCard; place: Place }) {
  const { lists, list, index } = place;
  const others = lists.filter((candidate) => candidate.epic && candidate.id !== list.id);
  const send = (to: string, at: number) => {
    const move = moveFor(lists, card.id, to, at);
    if (move) void store.move(card.id, move);
  };
  return (
    <div role="group" aria-label="Move this card" className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
      <Button size="sm" variant="secondary" disabled={place.sorted || index === 0} title={place.sorted ? 'Choose Sort by my order in the list menu to move cards' : undefined} onClick={() => send(list.id, index - 1)}>
        Move up
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={place.sorted || index === list.cards.length - 1}
        title={place.sorted ? 'Choose Sort by my order in the list menu to move cards' : undefined}
        onClick={() => send(list.id, index + 1)}
      >
        Move down
      </Button>
      {others.length > 0 && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Move to
          <select
            value=""
            onChange={(event) => {
              const to = lists.find((candidate) => candidate.id === event.target.value);
              if (to) send(to.id, to.cards.length);
            }}
            className="h-8 text-[13px] text-text"
          >
            <option value="">a list…</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function CardBack({ store, card, place, onBack }: { store: TodoStore; card: TodoCard; place: Place; onBack: () => void }) {
  const back = store.useBack(card.id);
  const [editing, setEditing] = useState(false);
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
      <p className="flex flex-wrap items-center gap-2 text-[15px] leading-snug font-semibold wrap-anywhere">
        {card.title}
        {card.pending && <PendingMark />}
      </p>
      {editing && (
        <EditCard
          card={card}
          notes={back.description}
          notesKnown={back.status === 'ready'}
          onCancel={() => setEditing(false)}
          onSave={(change) => {
            setEditing(false);
            void store.edit(card.id, change);
          }}
        />
      )}
      {!editing && back.status === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner size={16} />
          Loading the notes…
        </div>
      )}
      {!editing && back.status === 'error' && <p className="text-[13px] text-danger">The notes could not be fetched. Turn the card over again to retry.</p>}
      {!editing && back.status === 'missing' && <p className="text-[13px] text-muted">The notes are not available.</p>}
      {!editing && back.status === 'ready' && (back.description.trim() ? <Markdown text={back.description} wrap /> : <p className="text-[13px] text-muted">No notes.</p>)}
      {!editing && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={back.status === 'loading'} title={back.status === 'loading' ? 'Edit is ready once the notes have loaded' : undefined} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
      {!editing && <DueField key={card.due ?? ''} card={card} onSet={(due) => void store.edit(card.id, { due })} />}
      <MoveControls store={store} card={card} place={place} />
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

function Card({ store, card, place, drag, onPress, wasDragged }: { store: TodoStore; card: TodoCard; place: Place; drag?: DragState; onPress: (event: React.PointerEvent<HTMLElement>) => void; wasDragged: () => boolean }) {
  const [over, setOver] = useState(false);
  const state = store.useDone(card.id);
  const held = drag?.card === card.id;
  const shift = (to: number, by: number) => {
    const move = moveFor(place.lists, card.id, place.lists[to]?.id ?? place.list.id, by);
    if (move) void store.move(card.id, move);
  };
  // Alt + arrow keys: the keyboard's drag. Up and down walk the list; left and right carry the card to the foot of the next list.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return;
    const listAt = place.lists.indexOf(place.list);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (place.sorted) return;
      shift(listAt, place.index + (event.key === 'ArrowUp' ? -1 : 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = place.lists.findIndex((candidate, at) => candidate.epic && at === listAt + (event.key === 'ArrowLeft' ? -1 : 1));
      if (next >= 0) shift(next, place.lists[next].cards.length);
    } else return;
    event.preventDefault();
  };
  return (
    <li
      data-testid="todo-card"
      data-card={card.id}
      onPointerDown={over || card.adding || place.sorted ? undefined : onPress}
      onClickCapture={(event) => {
        if (wasDragged()) event.stopPropagation();
      }}
      onContextMenu={over ? undefined : (event) => event.preventDefault()}
      className={cx('relative rounded-xl border border-line bg-surface p-3', !over && 'select-none', state.waiting && !over && 'opacity-60', held && 'opacity-40')}
    >
      {over ? (
        <CardBack store={store} card={card} place={place} onBack={() => setOver(false)} />
      ) : card.adding ? (
        <p className="flex items-start gap-2 text-[15px] leading-snug font-medium wrap-anywhere">
          <span className="min-w-0 flex-1">{card.title}</span>
          <PendingMark />
        </p>
      ) : (
        <>
          <button
            type="button"
            title="Turn the card over"
            onClick={() => setOver(true)}
            onKeyDown={onKeyDown}
            className="flex w-full items-start gap-2 text-left text-[15px] leading-snug font-medium wrap-anywhere"
          >
            <span className="min-w-0 flex-1">{card.title}</span>
            {card.pending && <PendingMark />}
            <Icon name="forward" size={16} className="mt-0.5 shrink-0 text-faint" />
          </button>
          {card.due && <DueLine due={card.due} />}
          <CardLinks store={store} card={card} />
          <div data-nodrag>
            <DoneControl state={state} />
          </div>
        </>
      )}
      {over && <DoneControl state={state} />}
    </li>
  );
}

function AddCard({ store, list }: { store: TodoStore; list: TodoList }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const trimmed = title.trim();
  if (!adding) {
    return (
      <div className="px-2 pb-2" data-nodrag>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
          Add a card
        </Button>
      </div>
    );
  }
  const close = () => {
    setAdding(false);
    setTitle('');
  };
  return (
    <form
      aria-label={`Add a card to ${list.title}`}
      className="flex flex-col gap-2 px-2 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        void store.add(list.id, trimmed);
        close();
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && close()} placeholder="What needs doing?" aria-label="Title of the new card" className="h-10 w-full text-[15px]" ref={focusOnMount} />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A list's menu: today just how its cards are ordered, his own order or by due time. */
function ListMenu({ sorted, onSort }: { sorted: boolean; onSort: (sorted: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0" data-nodrag>
      <IconButton icon="more" label="List menu" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)} />
      {open && (
        <div role="menu" aria-label="List menu" className="absolute top-full right-0 z-20 mt-1 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            className="flex h-9 w-full items-center rounded-lg px-3 text-left text-[14px] hover:bg-raised"
            onClick={() => {
              onSort(!sorted);
              setOpen(false);
            }}
          >
            {sorted ? 'Sort by my order' : 'Sort by due'}
          </button>
        </div>
      )}
    </div>
  );
}

function Column({
  store,
  lists,
  list,
  sorted,
  onSort,
  drag,
  onPress,
  wasDragged,
}: {
  store: TodoStore;
  lists: TodoList[];
  list: TodoList;
  sorted: boolean;
  onSort: (sorted: boolean) => void;
  drag?: DragState;
  onPress: (card: string, event: React.PointerEvent<HTMLElement>) => void;
  wasDragged: () => boolean;
}) {
  // A card cannot be dropped into a list shown by due: where it lands there is not a place in his own order.
  const slot = !sorted && drag?.target?.list === list.id ? drag.target.index : undefined;
  const rows: React.ReactNode[] = [];
  let others = 0;
  (sorted ? sortByDue(list.cards) : list.cards).forEach((card, index) => {
    const held = drag?.card === card.id;
    if (!held && slot === others) rows.push(<li key="drop" aria-hidden data-testid="drop-mark" className="-my-1 h-1 shrink-0 rounded-full bg-accent" />);
    rows.push(<Card key={card.id} store={store} card={card} place={{ lists, list, index, sorted }} drag={drag} onPress={(event) => onPress(card.id, event)} wasDragged={wasDragged} />);
    if (!held) others++;
  });
  if (slot !== undefined && slot >= others) rows.push(<li key="drop" aria-hidden data-testid="drop-mark" className="-my-1 h-1 shrink-0 rounded-full bg-accent" />);
  return (
    <section aria-label={list.title} data-list={list.id} className="flex max-h-full min-h-0 w-full shrink-0 snap-start flex-col rounded-2xl border border-line bg-canvas lg:w-80">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold wrap-anywhere">{list.epic ? <a href={beadHref(list.epic)}>{list.title}</a> : list.title}</h2>
        {sorted && <span className="text-[11px] text-muted">by due</span>}
        <span className="rounded-full bg-raised px-2 text-[11px] text-muted tabular-nums">{list.cards.length}</span>
        <ListMenu sorted={sorted} onSort={onSort} />
      </header>
      <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">{rows}</ul>
      {list.epic && <AddCard store={store} list={list} />}
    </section>
  );
}

/** The board over any store. */
export function Board({ store }: { store: TodoStore }) {
  const lists = store.lists;
  const scroller = useRef<HTMLDivElement>(null);
  const [byDue, setByDue] = useState<ReadonlySet<string>>(new Set());
  const { drag, startDrag, wasDragged } = useCardDrag(scroller, (card, list, index) => {
    const move = lists && !byDue.has(list) ? moveFor(lists, card, list, index) : undefined;
    if (move) void store.move(card, move);
  });
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
      {store.notices.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1 px-4 pt-2">
          {store.notices.map((notice) => (
            <div key={notice.id}>{notice.note}</div>
          ))}
        </div>
      )}
      {lists.length > 1 && <p className="shrink-0 px-4 pt-2 text-[12px] text-faint lg:hidden">Swipe sideways for the next list. Hold a card to move it.</p>}
      <div ref={scroller} className={cx('scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto p-4', drag && 'snap-none')}>
        {lists.map((list) => (
          <Column
            key={list.id}
            store={store}
            lists={lists}
            list={list}
            sorted={byDue.has(list.id)}
            onSort={(sorted) =>
              setByDue((was) => {
                const next = new Set(was);
                if (sorted) next.add(list.id);
                else next.delete(list.id);
                return next;
              })
            }
            drag={drag}
            onPress={startDrag}
            wasDragged={wasDragged}
          />
        ))}
      </div>
      {drag && (
        <div
          aria-hidden
          data-testid="dragged-card"
          className="pointer-events-none fixed z-50 rounded-xl border border-line bg-surface p-3 text-[15px] leading-snug font-medium shadow-lg ring-2 ring-accent wrap-anywhere"
          style={{ left: drag.from.left + drag.dx, top: drag.from.top + drag.dy, width: drag.from.width }}
        >
          {lists.flatMap((list) => list.cards).find((card) => card.id === drag.card)?.title}
        </div>
      )}
    </div>
  );
}

/** The board over the Postern view. */
export function TodoBoard() {
  return <Board store={usePosternTodoStore()} />;
}
