// src/cockpit/HoldToTalkBar.tsx — the big hold-to-talk bar: full width, rounded, the mic over its
// label. The Talk line (?v=line) and the composer both draw it, so a hold feels the same in both.
// The caller says what a hold does (press, release, abort) and what the bar says; with
// `dropOnSlideOff` a finger that slides off the bar before letting go drops the hold (the bar says
// 'Let go to keep it unsent': the composer keeps the words in its box, mw-f7gmps.3) instead of sending it.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Icon, cx } from '../ui';

/** How far outside the bar the finger has to go before the hold counts as slid off, so a wobble at the edge does not drop it. */
export const SLIDE_OFF_MARGIN_PX = 24;

export const DROP_LABEL = 'Let go to keep it unsent';

export interface HoldToTalkBarProps {
  /** What a hold will do (or why it cannot be held now). */
  label: string;
  /** True while the bar is held. */
  listening: boolean;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
  onAbort: () => void;
  dropOnSlideOff?: boolean;
}

export function HoldToTalkBar({ label, listening, disabled, onPress, onRelease, onAbort, dropOnSlideOff = false }: HoldToTalkBarProps) {
  const [slid, setSlid] = useState(false);
  // Read when the finger lifts, which can be before the state above has re-rendered.
  const slidNow = useRef(false);
  const setSlidOff = (value: boolean) => {
    slidNow.current = value;
    setSlid(value);
  };

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // a pointer that is already gone: the press still counts
    }
    setSlidOff(false);
    onPress();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dropOnSlideOff || !listening) return;
    const box = event.currentTarget.getBoundingClientRect();
    const m = SLIDE_OFF_MARGIN_PX;
    const off = event.clientX < box.left - m || event.clientX > box.right + m || event.clientY < box.top - m || event.clientY > box.bottom + m;
    if (off !== slidNow.current) setSlidOff(off);
  };
  const lift = () => {
    const drop = slidNow.current;
    setSlidOff(false);
    if (drop) onAbort();
    else onRelease();
  };
  const cancel = () => {
    setSlidOff(false);
    onAbort();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) onPress();
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') onRelease();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={lift}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      className={cx(
        'flex h-24 min-h-12 w-full max-w-xl touch-none flex-col items-center justify-center gap-1 rounded-3xl text-[16px] font-semibold transition-colors select-none [-webkit-touch-callout:none]',
        slid ? 'bg-danger text-canvas' : listening ? 'bg-needs text-canvas' : 'bg-accent text-accent-fg',
        'disabled:cursor-not-allowed disabled:opacity-45',
      )}
    >
      <Icon name="mic" size={26} />
      {slid ? DROP_LABEL : label}
    </button>
  );
}
