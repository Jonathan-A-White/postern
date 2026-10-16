// src/todo/TodoBoard.tsx — the To do board (mw-ev7oyy.4): his own outside things, a column per list
// (side by side on a wide screen, one column per screen width to swipe across on a phone), a card per
// item. A tap on a card turns it over to its back (its notes, its comments, the beads it names, Edit
// and the keyboard's way to move it); Done asks for the card to be closed and the card stays, greyed,
// until the view drops it. A card is dragged (held, on a phone) to reorder it or move it to another
// list; each list ends in 'Add a card'. A card with a due time says it in words on its face ('due Thu', 'overdue since Tue', never red), its back sets or
// clears it with a date-time input, a star at its right marks it important (mw-ev7oyy.15; the store floats the due-soon and the important cards up), and a list's menu sorts its cards by due (mw-ev7oyy.9). Every change shows at once, marked pending, until the view agrees
// (mw-ev7oyy.7). A card is one compact row (mw-ev7oyy.14): a small round check at its left for Done, the title, then its due
// time and chips; a list's header is its short name. A list's cards are grouped Today, Soon and Someday (mw-ev7oyy.16; lists.ts groupCards): Today is
// open, the others folded to their count and opened with a tap, each list's choice kept on the phone (kept.ts); a card's back can tap it into Today for today. A card whose notes have an 'Open:' line shows a chip per link under its title, a tap opening the
// link and nothing else (mw-ev7oyy.12; links.ts says what each is); one with an Audible book (an 'Audible:' or 'Listen:' line, or an audible.com/pd/ link) shows
// a Listen in Audible button, its link built by audible-kit when tapped (mw-ev7oyy.24); one with a 'Text:' line shows a Text button first, which opens his
// texting app to the person with the message filled in (mw-ev7oyy.22); one with an 'Email:' line shows an Email button after it, which opens his mail app to the
// person with the subject and the draft filled in (mw-ev7oyy.26). A card's back has a Size row (Quick, an Hour, a Half day: a tap sets one, a second clears it) and a Then line, and its front a small size mark (Q, 1h, half) when set (mw-ht6gsw.4). Draws only what a TodoStore gives it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Chip, EmptyState, Icon, IconButton, LengthNote, Spinner, cx, isTooLong } from '../ui';
import { useNow } from '../ui/useNow';
import { focusOnMount } from '../ui/focus';
import { Markdown } from '../markdown/Markdown';
import { beadHref } from '../nav/route';
import { dueToInput, dueWords, inputToDue, isOverdue, sortByDue } from './due';
import { moveFor, realIndex } from './edits';
import { isGroupOpen, keepGroupOpen, readGroupsOpen, type GroupsOpen } from './kept';
import { emailHref, emailLabel, linkProps, listenHref, openLinkLabel, openLinkName, parseEmailAction, parseListenAction, parseOpenLinks, parseTextAction, textHref, textLabel, type EmailAction, type ListenAction, type OpenLink, type TextAction } from './links';
import { beadsNamed, groupCounts, type TodoCard, type TodoGroup, type TodoList, type TodoSize } from './lists';
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
  /** Opens the list's Today group, so a card tapped into Today is seen to arrive. */
  showToday: () => void;
}

const GROUP_NAMES: Record<TodoGroup, string> = { today: 'Today', soon: 'Soon', someday: 'Someday' };

/** Where it is kept (localStorage) that he has swiped across the lists once: the hint for it then goes (mw-ev7oyy.14). */
const SWIPED_KEY = 'postern.todo.swiped';

function hasSwiped(): boolean {
  try {
    return localStorage.getItem(SWIPED_KEY) === '1';
  } catch {
    return false;
  }
}

function keepSwiped(): void {
  try {
    localStorage.setItem(SWIPED_KEY, '1');
  } catch {
    // a phone that will not keep it shows the hint again, no harm
  }
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

/** The due date on a card's face, in words ('due Thu', 'due today', 'overdue since Tue'), never in red (mw-ev7oyy.15); an overdue one is bolder. */
function DueLine({ due }: { due: string }) {
  const now = useNow(DUE_LOOK_MS);
  const overdue = isOverdue(due, now);
  return (
    <p data-testid="due" data-past={overdue} className={cx('mt-0.5 flex items-center gap-1 text-[12.5px] text-muted', overdue && 'font-medium')}>
      <Icon name="clock" size={13} />
      {dueWords(due, now)}
    </p>
  );
}

/** The star at a card's right: one tap marks the card important, a second clears it. Named for what a tap will do ('Mark important: <title>'
 * / 'Clear important: <title>'); a filled star says it is on. Its tap area is wider than it looks. */
function StarButton({ card, onToggle }: { card: TodoCard; onToggle: (important: boolean) => void }) {
  const on = card.important === true;
  return (
    <button
      type="button"
      aria-label={`${on ? 'Clear important' : 'Mark important'}: ${card.title}`}
      onClick={() => onToggle(!on)}
      className={cx("relative mt-px flex size-6 shrink-0 items-center justify-center before:absolute before:-inset-2.5 before:content-['']", on ? 'text-accent' : 'text-faint hover:text-accent focus-visible:text-accent')}
    >
      <Icon name="star" size={18} className={on ? 'fill-current' : undefined} />
    </button>
  );
}

/** The sizes a card can have, in the words of its back's Size row and the small mark on its front (mw-ht6gsw.4). */
const SIZES: { size: TodoSize; label: string; mark: string }[] = [
  { size: 'quick', label: 'Quick', mark: 'Q' },
  { size: 'hour', label: 'an Hour', mark: '1h' },
  { size: 'half-day', label: 'a Half day', mark: 'half' },
];

/** A card's size on its face, small: Q, 1h or half; nothing for a card without one. */
function SizeMark({ size }: { size: TodoSize }) {
  const named = SIZES.find((candidate) => candidate.size === size);
  if (!named) return null;
  return (
    <span data-testid="size-mark" title={named.label} className="mt-0.5 inline-flex items-center rounded-full border border-line px-1.5 text-[11px] leading-4 font-medium text-muted">
      {named.mark}
    </span>
  );
}

/** The Size row of a card's back: Quick, an Hour, a Half day. The chosen one is marked (pressed); a tap on another sets it, a second tap on the chosen one clears it. */
function SizeField({ card, onSet }: { card: TodoCard; onSet: (size: TodoSize | '') => void }) {
  return (
    <div role="group" aria-label="Size" className="flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] text-muted">Size</span>
      {SIZES.map(({ size, label }) => {
        const on = card.size === size;
        return (
          <Button key={size} size="sm" variant={on ? 'primary' : 'secondary'} aria-pressed={on} title={on ? `Tap to clear the size (now ${label})` : undefined} onClick={() => onSet(on ? '' : size)}>
            {label}
          </Button>
        );
      })}
    </div>
  );
}

/** The longest Then line the host keeps, in characters (docs/protocol.md §13 todo_edit). */
const THEN_MAX = 200;
const THEN_LENGTH_ID = 'then-length';

/** The Then row of a card's back: one line of text, what must follow the card. Its button (dead until the line differs from the card's, and while it is too long, the count saying so) says what a tap does: Save Then, or Clear Then once the line is empty. */
function ThenField({ card, onSet }: { card: TodoCard; onSet: (then: string) => void }) {
  const current = card.then ?? '';
  const [value, setValue] = useState(current);
  const trimmed = value.trim();
  const tooLong = isTooLong(value, THEN_MAX);
  const changed = trimmed !== current && !tooLong;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) onSet(trimmed);
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12.5px] text-muted">
        Then
        <input value={value} placeholder="Then: what must follow" aria-describedby={tooLong ? THEN_LENGTH_ID : undefined} onChange={(event) => setValue(event.target.value)} className="h-10 w-full text-[14px] text-text" />
      </label>
      <Button size="sm" variant="secondary" type="submit" disabled={!changed}>
        {!trimmed && current ? 'Clear Then' : 'Save Then'}
      </Button>
      <LengthNote id={THEN_LENGTH_ID} text={value} max={THEN_MAX} what="Then line" className="basis-full" />
    </form>
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

/** A card's links as chips under its title: each an anchor that opens the app it names (links.ts says how), named 'Open in <its text>' for a screen reader;
 * with an 'Open:' line per book, each chip names its book too ('Kindle · Deep Discipleship', 'Open Deep Discipleship in Kindle'; openLinkLabel, openLinkName).
 * A text action comes first, as a Text button that says who a tap texts: opened in this tab, so the phone hands it to his texting app (Google Voice on Android).
 * An email action follows it, an Email button that says who a tap writes to: a mailto: link, opened in this tab, so the phone hands it to his mail app (Gmail). */
function LinkChips({ links, text, email, listen }: { links: OpenLink[]; text?: TextAction; email?: EmailAction; listen?: ListenAction }) {
  if (links.length === 0 && !text && !email && !listen) return null;
  return (
    <div data-nodrag data-testid="card-links" className="mt-1 flex flex-wrap gap-1.5">
      {text && (
        <a
          data-testid="card-text"
          data-kind="text"
          href={textHref(text, navigator.userAgent)}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-accent/60 bg-accent/15 px-2 text-[12px] font-medium text-fg no-underline"
        >
          <Icon name="talk" size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{textLabel(text)}</span>
        </a>
      )}
      {email && (
        <a
          data-testid="card-email"
          data-kind="email"
          href={emailHref(email)}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-accent/60 bg-accent/15 px-2 text-[12px] font-medium text-fg no-underline"
        >
          <Icon name="mail" size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{emailLabel(email)}</span>
        </a>
      )}
      {listen && (
        <a
          data-testid="card-listen"
          data-kind="listen"
          href={listenHref(listen)}
          onClick={(event) => {
            // Audible wants the link stamped with the time of this tap: rebuild it before the browser follows it
            event.currentTarget.href = listenHref(listen);
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-accent/60 bg-accent/15 px-2 text-[12px] font-medium text-fg no-underline"
        >
          <Icon name="speaker" size={12} className="shrink-0" />
          <span className="min-w-0 truncate">Listen in Audible</span>
        </a>
      )}
      {links.map((link, at) => (
        <a
          key={`${at}|${link.url}`}
          {...linkProps(link, navigator.userAgent)}
          aria-label={openLinkName(link)}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-line px-2 text-[12px] text-muted no-underline"
        >
          <Icon name="link" size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{openLinkLabel(link)}</span>
        </a>
      ))}
    </div>
  );
}

/** The chips of a card whose view summary may be cut short: the whole notes, once the store has them, decide (the summary's links stand in until then;
 * the Text and Email buttons wait for them, as a cut summary may have cut its draft). */
function FullNotesChips({ store, card }: { store: TodoStore; card: TodoCard }) {
  const back = store.useBack(card.id);
  return back.status === 'ready' ? <LinkChips links={parseOpenLinks(back.description)} text={parseTextAction(back.description)} email={parseEmailAction(back.description)} listen={parseListenAction(back.description)} /> : <LinkChips links={card.links ?? []} />;
}

function CardLinks({ store, card }: { store: TodoStore; card: TodoCard }) {
  return card.summaryCut ? <FullNotesChips store={store} card={card} /> : <LinkChips links={card.links ?? []} text={card.text} email={card.email} listen={card.listen} />;
}

/** The back's Done: a labelled button, as it was before the card's front became one row. */
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

/** The card's front Done: a 24 px round check at the row's left, named 'Done: <title>' for a screen reader (its tap area is wider than it looks).
 * Waiting, it is a spinning ring and the row says why; when the tap came to grief it is a dead ring and the note says what to do. */
function DoneCheck({ title, state: { waiting, note, done } }: { title: string; state: TodoDone }) {
  if (waiting || note) {
    return (
      <span aria-hidden data-testid="done-check-dead" className={cx('mt-px flex size-6 shrink-0 items-center justify-center', note ? 'text-danger' : 'text-muted')}>
        {waiting ? <Spinner size={24} /> : <span className="size-6 rounded-full border-2 border-current opacity-50" />}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Done: ${title}`}
      onClick={done}
      className="group relative mt-px flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted text-transparent transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent"
    >
      <Icon name="check" size={14} />
    </button>
  );
}

/** What stands under a row once Done has been tapped: the words that it waits, or the note that it did not go. */
function DoneStatus({ state: { waiting, note } }: { state: TodoDone }) {
  if (note) return <div className="mt-1">{note}</div>;
  if (!waiting) return null;
  return (
    <p role="status" className="mt-1 text-[12.5px] text-muted">
      Done, waiting for the Mayor
    </p>
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
  const tapped = card.tapped === true;
  return (
    <div role="group" aria-label="Move this card" className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
      {(tapped || card.group !== 'today') && !card.adding && (
        <Button
          size="sm"
          variant="secondary"
          title={tapped ? 'Today only: the card is back in its own group tomorrow' : 'For today only: the card is back in its own group tomorrow'}
          onClick={() => {
            store.today(card.id, !tapped);
            if (!tapped) place.showToday();
          }}
        >
          {tapped ? 'Back to its own group' : 'Move to Today'}
        </Button>
      )}
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
                {other.name}
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
      {!editing && <DueField key={`due|${card.due ?? ''}`} card={card} onSet={(due) => void store.edit(card.id, { due })} />}
      {!editing && <SizeField card={card} onSet={(size) => void store.edit(card.id, { size })} />}
      {!editing && <ThenField key={`then|${card.then ?? ''}`} card={card} onSet={(then) => void store.edit(card.id, { then })} />}
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
      className={cx('relative rounded-xl border border-line bg-surface px-3 py-2.5', !over && 'select-none', state.waiting && !over && 'opacity-60', held && 'opacity-40')}
    >
      {over ? (
        <CardBack store={store} card={card} place={place} onBack={() => setOver(false)} />
      ) : card.adding ? (
        <p className="flex items-start gap-2 text-[15px] leading-snug font-medium wrap-anywhere">
          <span className="min-w-0 flex-1">{card.title}</span>
          <PendingMark />
        </p>
      ) : (
        <div className="flex items-start gap-2.5">
          <div data-nodrag className="flex shrink-0">
            <DoneCheck title={card.title} state={state} />
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              title="Turn the card over"
              onClick={() => setOver(true)}
              onKeyDown={onKeyDown}
              className="flex w-full items-start gap-2 text-left text-[15px] leading-snug font-medium wrap-anywhere"
            >
              <span className="line-clamp-2 min-w-0 flex-1">{card.title}</span>
              {card.pending && <PendingMark />}
            </button>
            {(card.due || card.size) && (
              <div className="flex flex-wrap items-center gap-x-2">
                {card.due && <DueLine due={card.due} />}
                {card.size && <SizeMark size={card.size} />}
              </div>
            )}
            <CardLinks store={store} card={card} />
            <div data-nodrag>
              <DoneStatus state={state} />
            </div>
          </div>
          <div data-nodrag className="flex shrink-0">
            <StarButton card={card} onToggle={(important) => void store.edit(card.id, { important })} />
          </div>
        </div>
      )}
      {over && <DoneControl state={state} />}
    </li>
  );
}

function AddCard({ store, list, onAdded }: { store: TodoStore; list: TodoList; onAdded: () => void }) {
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
      aria-label={`Add a card to ${list.name}`}
      className="flex flex-col gap-2 px-2 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        void store.add(list.id, trimmed);
        onAdded();
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

/** A list's menu: how its cards are ordered, his own order or by due time, and (when the header is cut short) the list's whole title. */
function ListMenu({ title, name, sorted, onSort }: { title: string; name: string; sorted: boolean; onSort: (sorted: boolean) => void }) {
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
        <div role="menu" aria-label="List menu" className="absolute top-full right-0 z-20 mt-1 min-w-44 max-w-[min(18rem,80vw)] rounded-xl border border-line bg-surface p-1 shadow-lg">
          {title !== name && <p className="px-3 py-2 text-[12.5px] leading-snug text-muted wrap-anywhere">{title}</p>}
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

/** A group's header in a list: its name and its count, one tap to fold or open it. Named for what a tap will do ('Open Soon, 3 cards'). */
function GroupHeader({ group, count, open, onToggle }: { group: TodoGroup; count: number; open: boolean; onToggle: () => void }) {
  const name = GROUP_NAMES[group];
  return (
    <li data-testid="todo-group" data-group={group} data-open={open} className="-mb-1 flex" data-nodrag>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Fold' : 'Open'} ${name}, ${count} ${count === 1 ? 'card' : 'cards'}`}
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-1.5 rounded-lg px-1.5 text-left text-[13px] font-semibold text-muted hover:bg-raised"
      >
        <Icon name={open ? 'down' : 'forward'} size={14} />
        <span className="flex-1">{name}</span>
        <span className="rounded-full bg-raised px-2 text-[11px] font-normal tabular-nums">{count}</span>
      </button>
    </li>
  );
}

function Column({
  store,
  lists,
  list,
  sorted,
  onSort,
  open,
  onToggle,
  onAdded,
  drag,
  onPress,
  wasDragged,
}: {
  store: TodoStore;
  lists: TodoList[];
  list: TodoList;
  sorted: boolean;
  onSort: (sorted: boolean) => void;
  open: (group: TodoGroup) => boolean;
  onToggle: (group: TodoGroup, open: boolean) => void;
  onAdded: () => void;
  drag?: DragState;
  onPress: (card: string, event: React.PointerEvent<HTMLElement>) => void;
  wasDragged: () => boolean;
}) {
  // A card cannot be dropped into a list shown by due: where it lands there is not a place in his own order.
  const slot = !sorted && drag?.target?.list === list.id ? drag.target.index : undefined;
  const rows: React.ReactNode[] = [];
  let others = 0;
  const showToday = () => onToggle('today', true);
  let at = 0;
  for (const { group, count } of groupCounts(list.cards)) {
    const isOpen = open(group);
    rows.push(<GroupHeader key={`group-${group}`} group={group} count={count} open={isOpen} onToggle={() => onToggle(group, !isOpen)} />);
    const members = list.cards.filter((card) => (card.group ?? 'today') === group);
    const first = at;
    at += members.length;
    if (!isOpen) continue;
    (sorted ? sortByDue(members) : members).forEach((card, within) => {
      const held = drag?.card === card.id;
      if (!held && slot === others) rows.push(<li key="drop" aria-hidden data-testid="drop-mark" className="-my-1 h-1 shrink-0 rounded-full bg-accent" />);
      // a card's place in its list is its place in the groups' order, which the sort by due leaves in the group
      rows.push(<Card key={card.id} store={store} card={card} place={{ lists, list, index: first + within, sorted, showToday }} drag={drag} onPress={(event) => onPress(card.id, event)} wasDragged={wasDragged} />);
      if (!held) others++;
    });
  }
  if (slot !== undefined && slot >= others) rows.push(<li key="drop" aria-hidden data-testid="drop-mark" className="-my-1 h-1 shrink-0 rounded-full bg-accent" />);
  return (
    <section aria-label={list.name} data-list={list.id} className="flex max-h-full min-h-0 w-full shrink-0 snap-start flex-col rounded-2xl border border-line bg-canvas lg:w-80">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{list.epic ? <a href={beadHref(list.epic)}>{list.name}</a> : list.name}</h2>
        {sorted && <span className="text-[11px] text-muted">by due</span>}
        <span className="rounded-full bg-raised px-2 text-[11px] text-muted tabular-nums">{list.cards.length}</span>
        <ListMenu title={list.title} name={list.name} sorted={sorted} onSort={onSort} />
      </header>
      <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">{rows}</ul>
      {list.epic && <AddCard store={store} list={list} onAdded={onAdded} />}
    </section>
  );
}

/** The board over any store. */
export function Board({ store }: { store: TodoStore }) {
  const lists = store.lists;
  const scroller = useRef<HTMLDivElement>(null);
  const [byDue, setByDue] = useState<ReadonlySet<string>>(new Set());
  const [swiped, setSwiped] = useState(hasSwiped);
  const [opened, setOpened] = useState<GroupsOpen>(readGroupsOpen);
  const { drag, startDrag, wasDragged } = useCardDrag(scroller, (card, list, index) => {
    // the index counts the cards on screen; the cards in folded groups are not, so it is turned into a place among them all
    const target = lists?.find((candidate) => candidate.id === list);
    const real = target ? realIndex(target, card, index, (other) => isGroupOpen(opened, list, other.group ?? 'today')) : index;
    const move = lists && !byDue.has(list) ? moveFor(lists, card, list, real) : undefined;
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
      {lists.length > 1 && !swiped && <p className="shrink-0 px-4 pt-2 text-[12px] text-faint lg:hidden">Swipe sideways for the next list. Hold a card to move it.</p>}
      <div
        ref={scroller}
        data-testid="todo-lists"
        onScroll={(event) => {
          if (swiped || event.currentTarget.scrollLeft < 1) return;
          keepSwiped();
          setSwiped(true);
        }}
        className={cx('scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto p-4', drag && 'snap-none')}
      >
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
            open={(group) => isGroupOpen(opened, list.id, group)}
            onToggle={(group, open) => setOpened((was) => keepGroupOpen(was, list.id, group, open))}
            onAdded={() => setOpened((was) => keepGroupOpen(was, list.id, 'someday', true))}
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
