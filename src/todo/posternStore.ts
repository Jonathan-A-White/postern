// src/todo/posternStore.ts — the one TodoStore adapter: lists and cards from the Postern view
// (docs/protocol.md §11), Done as the §13 close action through the outbox, a card's back from
// the bead's detail (§12). Add, edit and move are the §13 todo_add / todo_edit / todo_move actions
// through the same outbox: the board shows each at once from the outbox's own rows (edits.ts),
// marked pending until the view has reached the event that echoed it, and rolls it back with a
// notice when the backend or the Mayor's host refuses it. The only file of src/todo/ that knows
// the cockpit's hooks.
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useBeadDetail, useTodoRows, useViewIndex } from '../cockpit/hooks';
import { useOneTap } from '../cockpit/oneTap';
import { FailedNote } from '../cockpit/OutboxMark';
import { sendAction } from '../cockpit/send';
import { useNow } from '../ui/useNow';
import { NOTE_FOR_MS, applyChanges, describeChange, judge, todoActionOf, type TodoChange } from './edits';
import { keepTodayPick, readTodayPicks } from './kept';
import { openTodoCount, pickCards, todoListsFromView, type TodayPicks } from './lists';
import { RefusedNote } from './RefusedNote';
import type { TodoBack, TodoDone, TodoStore } from './store';

/** How often the board looks at the clock to call a change the Mayor has not echoed refused. */
const LOOK_MS = 5_000;

function useDone(bead: string, reason?: string): TodoDone {
  const tap = useOneTap(bead, 'close');
  const failed = tap.queued?.state === 'failed' ? tap.queued : undefined;
  return {
    waiting: tap.waiting && !failed,
    note: failed ? createElement(FailedNote, { id: failed.id as number, failure: failed.failure ?? 'The backend refused it.' }) : undefined,
    done: () => void tap.tap(() => sendAction({ action: 'close', bead, ...(reason ? { reason } : {}) }), reason ? `Dropped ${bead}` : `Marked ${bead} done`),
  };
}

/** `settledEdits`: how many of this card's edits the view has caught up with; each fetches the back again, for the notes the view does not carry. */
function useBack(bead: string, settledEdits: number): TodoBack {
  const { detail, status, refresh } = useBeadDetail(bead);
  useEffect(() => {
    if (settledEdits > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledEdits]);
  if (detail) return { status: 'ready', description: detail.description, comments: detail.comments };
  return { status: status === 'missing' || status === 'unsupported' ? 'missing' : status === 'error' ? 'error' : 'loading', description: '', comments: [] };
}

/** The store over the phone's stored view; `lists` is undefined until the phone has one. */
export function usePosternTodoStore(): TodoStore {
  const view = useViewIndex();
  const index = view?.index;
  const rows = useTodoRows();
  const now = useNow(LOOK_MS);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [picks, setPicks] = useState<TodayPicks>(() => readTodayPicks());
  const base = useMemo(() => (index ? todoListsFromView(index, now) : undefined), [index, now]);
  const stamp = useMemo(() => ({ seq: index?.view.seq, writtenAt: index?.view.written_at }), [index]);
  const judged = useMemo(
    () =>
      rows.flatMap(({ row, echoSeq }) => {
        const action = todoActionOf(row);
        return action ? [{ row, action, state: judge(row, { echoSeq, view: stamp, now }) }] : [];
      }),
    [rows, stamp, now],
  );
  const shown = useMemo(() => {
    const waiting: TodoChange[] = judged.filter((change) => change.state === 'waiting').map(({ row, action }) => ({ id: row.id as number, action }));
    if (!base) return { lists: undefined, notes: new Map<string, string>() };
    const changed = applyChanges(base, waiting);
    return { ...changed, lists: changed.lists.map((list) => ({ ...list, cards: pickCards(list.cards, now, picks) })) };
  }, [base, judged, now, picks]);
  const settled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { action, state } of judged) if (action.action === 'todo_edit' && state === 'settled') counts.set(action.bead, (counts.get(action.bead) ?? 0) + 1);
    return counts;
  }, [judged]);
  const titleOf = useCallback((bead: string) => index?.byId.get(bead)?.title, [index]);
  const notices = useMemo(
    () =>
      judged.flatMap(({ row, action, state }): TodoStore['notices'] => {
        const id = row.id as number;
        const words = describeChange(action, titleOf);
        if (state === 'failed') return [{ id, note: createElement(FailedNote, { id, failure: `${words}: ${row.failure ?? 'The backend refused it.'}` }) }];
        if (state === 'refused' && !dismissed.has(id) && now - (row.sentAt ?? now) < NOTE_FOR_MS) {
          return [{ id, note: createElement(RefusedNote, { words, onDismiss: () => setDismissed((was) => new Set(was).add(id)) }) }];
        }
        return [];
      }),
    [judged, titleOf, dismissed, now],
  );
  const editedNotes = shown.notes;
  const useBackOf = useMemo(
    () =>
      function useBackOf(bead: string): TodoBack {
        const back = useBack(bead, settled.get(bead) ?? 0);
        const edited = editedNotes.get(bead);
        return edited !== undefined && back.status !== 'loading' ? { ...back, status: 'ready', description: edited } : back;
      },
    [editedNotes, settled],
  );
  return useMemo(
    () => ({
      lists: shown.lists,
      titleOf,
      useDone,
      useBack: useBackOf,
      add: async (list, title) => void (await sendAction({ action: 'todo_add', list, title })),
      edit: async (card, change) => void (await sendAction({ action: 'todo_edit', bead: card, ...change })),
      move: async (card, to) => void (await sendAction({ action: 'todo_move', bead: card, ...to })),
      today: (card, into) => setPicks(keepTodayPick(card, into)),
      notices,
    }),
    [shown.lists, titleOf, useBackOf, notices],
  );
}

/** How many open cards there are, for the tab. */
export function useTodoCount(): number {
  const index = useViewIndex()?.index;
  return useMemo(() => (index ? openTodoCount(index) : 0), [index]);
}
