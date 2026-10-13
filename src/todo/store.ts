// src/todo/store.ts — what the To do board needs from wherever its lists live (mw-ev7oyy.4).
// The board draws only this; posternStore.ts is the one adapter, over the Postern view. Adding,
// editing and moving a card (mw-ev7oyy.7) are members of it: each shows at once in `lists`, marked
// pending, until the view agrees, and is rolled back with a notice if the other side refuses it.
import type { ReactNode } from 'react';
import type { TodoCardEdit, TodoMove } from './edits';
import type { TodoList } from './lists';

export interface TodoNote {
  at: string;
  author: string;
  text: string;
}

/** A card's back: its notes (the bead's description) and comments, once they have been fetched. */
export interface TodoBack {
  status: 'loading' | 'ready' | 'missing' | 'error';
  description: string;
  comments: TodoNote[];
}

/** One card's Done: `waiting` once it has been tapped and the view has not yet dropped the card;
 * `note` stands in for the waiting words when the tap came to grief (the store says how to recover). */
export interface TodoDone {
  waiting: boolean;
  note?: ReactNode;
  done: () => void;
}

export interface TodoStore {
  /** The lists, newest first, each with its cards in order; undefined until the store has them. */
  lists: TodoList[] | undefined;
  /** The title of a bead a card names, when the store knows it. */
  titleOf: (bead: string) => string | undefined;
  /** Hooks: called from components, once per card on screen. */
  useDone: (card: string) => TodoDone;
  useBack: (card: string) => TodoBack;
  /** Files a new card at the foot of a list (the epic's id). */
  add: (list: string, title: string) => Promise<void>;
  /** Changes a card's title and/or notes. */
  edit: (card: string, change: TodoCardEdit) => Promise<void>;
  /** Moves a card: to another list, and/or before or after a card. */
  move: (card: string, to: TodoMove) => Promise<void>;
  /** Changes that were refused or did not go, oldest first, each as the line that tells him (with what he may do about it). */
  notices: { id: number; note: ReactNode }[];
}
