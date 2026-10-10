// src/cockpit/ImageViewer.tsx — a tapped picture, full screen (mw-jtzpw0.5): in the composer
// before it is sent and in a message already sent. Pinch to zoom (one to six times), drag a zoomed
// picture around, double tap to zoom in and out, the wheel on a computer. Back (the phone's, the
// browser's) closes it and so do Escape and the Close button; whatever was under it is as he left it.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import { focusQuietly } from '../ui/focus';
import type { ShownPicture } from './useViewer';
import { DOUBLE_TAP_SCALE, MIN_SCALE, clampPan, clampScale, distance, pinchScale, type Point } from './zoom';

export function ImageViewer({ src, name, onClose }: ShownPicture & { onClose: () => void }) {
  const [view, setView] = useState({ scale: MIN_SCALE, x: 0, y: 0 });
  const surface = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const fingers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number }>(undefined);
  const dragged = useRef<Point>(undefined);

  useEffect(() => {
    focusQuietly(closeButton.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function extent(): Point {
    const box = surface.current;
    return { x: box?.clientWidth || window.innerWidth, y: box?.clientHeight || window.innerHeight };
  }

  /** A scale and where the picture sits at it; at its own size it sits in the middle. */
  function place(scale: number, x: number, y: number) {
    const size = extent();
    setView(scale <= MIN_SCALE ? { scale: MIN_SCALE, x: 0, y: 0 } : { scale, x: clampPan(x, scale, size.x), y: clampPan(y, scale, size.y) });
  }

  function twoFingers(): [Point, Point] | undefined {
    const [a, b] = Array.from(fingers.current.values());
    return a && b ? [a, b] : undefined;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const two = twoFingers();
    if (two) {
      pinch.current = { distance: distance(two[0], two[1]), scale: view.scale };
      dragged.current = undefined;
    } else {
      dragged.current = { x: event.clientX, y: event.clientY };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!fingers.current.has(event.pointerId)) return;
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const two = twoFingers();
    if (two && pinch.current) {
      place(pinchScale(pinch.current.scale, pinch.current.distance, distance(two[0], two[1])), view.x, view.y);
      return;
    }
    if (dragged.current && view.scale > MIN_SCALE) {
      place(view.scale, view.x + event.clientX - dragged.current.x, view.y + event.clientY - dragged.current.y);
      dragged.current = { x: event.clientX, y: event.clientY };
    }
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    fingers.current.delete(event.pointerId);
    pinch.current = undefined;
    // the finger left down carries on as a drag from where it is
    const [rest] = Array.from(fingers.current.values());
    dragged.current = rest;
  }

  const viewer = (
    <div role="dialog" aria-modal="true" aria-label="Picture" className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="pt-safe flex shrink-0 items-center gap-3 px-3 py-2">
        <button
          ref={closeButton}
          type="button"
          aria-label="Close picture"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-[14px] font-medium active:bg-white/25"
          onClick={onClose}
        >
          <Icon name="x" size={18} />
          Close
        </button>
        {name && <span className="min-w-0 flex-1 truncate text-[13.5px] text-white/80">{name}</span>}
      </div>
      <div
        ref={surface}
        data-testid="viewer-surface"
        className="pb-safe flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => place(view.scale > MIN_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE, 0, 0)}
        onWheel={(event) => place(clampScale(view.scale * Math.exp(-event.deltaY * 0.002)), view.x, view.y)}
      >
        <img
          src={src}
          alt={`${name ?? 'Picture'} (full screen)`}
          draggable={false}
          data-testid="viewer-image"
          data-scale={view.scale}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
    </div>
  );
  return createPortal(viewer, document.body);
}
