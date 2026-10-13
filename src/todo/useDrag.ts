// src/todo/useDrag.ts — dragging a card to reorder it or move it to another list (mw-ev7oyy.7).
// A mouse drags once it has moved a few pixels; a finger or pen presses and holds (LONG_PRESS_MS)
// first, so a swipe still scrolls the board; a finger that moves before the hold is up is a scroll.
// While a card is held the board scrolls sideways when the finger nears its edge (a phone shows one
// list at a time). Where it lands is dropPlace()'s answer over the measured columns.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { dropPlace, type Box, type MeasuredColumn } from './edits';

export const LONG_PRESS_MS = 380;
/** A finger that moves this far before the hold is up is scrolling, not dragging. */
const SCROLL_SLOP_PX = 10;
/** A mouse that moves this far has picked the card up. */
const MOUSE_SLOP_PX = 5;
const EDGE_PX = 48;
const SCROLL_STEP_PX = 14;
const SCROLL_EVERY_MS = 16;

export interface DragState {
  card: string;
  /** Where the card lay when it was picked up (viewport pixels), and how far it has been carried since. */
  from: { left: number; top: number; width: number };
  dx: number;
  dy: number;
  target?: { list: string; index: number };
}

const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** The board's columns and cards as they lie on screen now. */
function measure(root: HTMLElement): MeasuredColumn[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-list]')).map((column) => ({
    id: column.dataset.list as string,
    rect: box(column.getBoundingClientRect()),
    cards: Array.from(column.querySelectorAll<HTMLElement>('[data-card]')).map((card) => ({ id: card.dataset.card as string, rect: box(card.getBoundingClientRect()) })),
  }));
}

interface Press {
  card: string;
  pointer: number;
  touch: boolean;
  x: number;
  y: number;
  held: boolean;
  from: DragState['from'];
  timer?: ReturnType<typeof setTimeout>;
}

/** `root` is the board's scrolling box; `onDrop` hears a card dropped at an index of a list (counted without the card itself). */
export function useCardDrag(root: RefObject<HTMLElement | null>, onDrop: (card: string, list: string, index: number) => void) {
  const [drag, setDrag] = useState<DragState>();
  const press = useRef<Press>(undefined);
  const point = useRef({ x: 0, y: 0 });
  const swallow = useRef(false);
  const drop = useRef(onDrop);
  useEffect(() => {
    drop.current = onDrop;
  }, [onDrop]);
  const stop = useRef<() => void>(() => undefined);

  const begin = useCallback((current: Press) => {
    current.held = true;
    setDrag({ card: current.card, from: current.from, dx: 0, dy: 0 });
  }, []);

  const startDrag = useCallback(
    (card: string, event: ReactPointerEvent<HTMLElement>) => {
      if (press.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if ((event.target as HTMLElement).closest('[data-nodrag]')) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const current: Press = { card, pointer: event.pointerId, touch: event.pointerType !== 'mouse', x: event.clientX, y: event.clientY, held: false, from: { left: rect.left, top: rect.top, width: rect.width } };
      point.current = { x: event.clientX, y: event.clientY };
      press.current = current;

      const place = () => {
        const rootEl = root.current;
        const target = rootEl ? dropPlace(measure(rootEl), card, point.current.x, point.current.y) : undefined;
        setDrag({ card, from: current.from, dx: point.current.x - current.x, dy: point.current.y - current.y, target });
      };
      const finish = (dropped: boolean) => {
        const target = dropped && current.held && root.current ? dropPlace(measure(root.current), card, point.current.x, point.current.y) : undefined;
        stop.current();
        if (current.held) {
          swallow.current = true;
          setTimeout(() => (swallow.current = false), 0);
        }
        setDrag(undefined);
        if (target) drop.current(card, target.list, target.index);
      };
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== current.pointer) return;
        point.current = { x: move.clientX, y: move.clientY };
        const moved = Math.hypot(move.clientX - current.x, move.clientY - current.y);
        if (!current.held) {
          if (current.touch && moved > SCROLL_SLOP_PX) return finish(false);
          if (!current.touch && moved > MOUSE_SLOP_PX) begin(current);
          else return;
        }
        place();
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId === current.pointer) finish(true);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === current.pointer) finish(false);
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') finish(false);
      };
      // A held finger must not scroll the page under the card.
      const onTouchMove = (touch: TouchEvent) => {
        if (current.held && touch.cancelable) touch.preventDefault();
      };
      const onMenu = (menu: Event) => {
        if (current.held) menu.preventDefault();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('contextmenu', onMenu);
      if (current.touch) current.timer = setTimeout(() => begin(current), LONG_PRESS_MS);
      const scroller = setInterval(() => {
        const rootEl = root.current;
        if (!current.held || !rootEl) return;
        const rect = rootEl.getBoundingClientRect();
        const step = point.current.x < rect.left + EDGE_PX ? -SCROLL_STEP_PX : point.current.x > rect.right - EDGE_PX ? SCROLL_STEP_PX : 0;
        if (step === 0) return;
        const before = rootEl.scrollLeft;
        rootEl.scrollLeft += step;
        if (rootEl.scrollLeft !== before) place();
      }, SCROLL_EVERY_MS);
      stop.current = () => {
        clearTimeout(current.timer);
        clearInterval(scroller);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('contextmenu', onMenu);
        press.current = undefined;
        stop.current = () => undefined;
      };
    },
    [begin, root],
  );

  useEffect(() => () => stop.current(), []);

  /** True once, right after a drag: the click that follows a drop is not a tap on the card. */
  const wasDragged = useCallback(() => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  }, []);

  return { drag, startDrag, wasDragged };
}
