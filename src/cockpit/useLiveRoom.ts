// src/cockpit/useLiveRoom.ts — mw-j0f2d.44: while he holds to talk, the live words are drawn over the screen above the status
// line (index.css .bk-composer__live, .pc-live-words), so the bar below never moves as they grow. This tells that area how much
// room there is above the line (--live-room), so a screen that is tall with controls (the Talk line at 200 % text) never has the
// words reach past the top bar.
import { useEffect, type RefObject } from 'react';

const STATUS = '.bk-composer__status, .pc-hold-status';
const LIVE = '.bk-composer__live, .pc-live-words';
/** The least the live area is given, however little room the screen leaves above the line. */
const LEAST_ROOM_PX = 64;

export function useLiveRoom(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const settle = () => {
      const status = box.querySelector<HTMLElement>(STATUS);
      if (!status) return;
      if (!status.querySelector(LIVE)) {
        status.style.removeProperty('--live-room');
        return;
      }
      const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      status.style.setProperty('--live-room', `${Math.max(LEAST_ROOM_PX, status.getBoundingClientRect().top - header)}px`);
    };
    const watch = new MutationObserver(settle);
    watch.observe(box, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [root]);
}
