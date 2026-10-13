// src/todo/posternStore.ts — the one TodoStore adapter: lists and cards from the Postern view
// (docs/protocol.md §11), Done as the §13 close action through the outbox, a card's back from
// the bead's detail (§12). The only file of src/todo/ that knows the cockpit's hooks.
import { createElement, useMemo } from 'react';
import { useBeadDetail, useViewIndex } from '../cockpit/hooks';
import { useOneTap } from '../cockpit/oneTap';
import { FailedNote } from '../cockpit/OutboxMark';
import { sendAction } from '../cockpit/send';
import { openTodoCount, todoListsFromView } from './lists';
import type { TodoBack, TodoDone, TodoStore } from './store';

function useDone(bead: string): TodoDone {
  const tap = useOneTap(bead, 'close');
  const failed = tap.queued?.state === 'failed' ? tap.queued : undefined;
  return {
    waiting: tap.waiting && !failed,
    note: failed ? createElement(FailedNote, { id: failed.id as number, failure: failed.failure ?? 'The backend refused it.' }) : undefined,
    done: () => void tap.tap(() => sendAction({ action: 'close', bead }), `Marked ${bead} done`),
  };
}

function useBack(bead: string): TodoBack {
  const { detail, status } = useBeadDetail(bead);
  if (detail) return { status: 'ready', description: detail.description, comments: detail.comments };
  return { status: status === 'missing' || status === 'unsupported' ? 'missing' : status === 'error' ? 'error' : 'loading', description: '', comments: [] };
}

/** The store over the phone's stored view; `lists` is undefined until the phone has one. */
export function usePosternTodoStore(): TodoStore {
  const view = useViewIndex();
  const index = view?.index;
  const lists = useMemo(() => (index ? todoListsFromView(index) : undefined), [index]);
  return useMemo(() => ({ lists, titleOf: (bead: string) => index?.byId.get(bead)?.title, useDone, useBack }), [lists, index]);
}

/** How many open cards there are, for the tab. */
export function useTodoCount(): number {
  const index = useViewIndex()?.index;
  return useMemo(() => (index ? openTodoCount(index) : 0), [index]);
}
