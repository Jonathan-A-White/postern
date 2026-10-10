// src/cockpit/useViewer.ts — which picture a screen has open full screen (ImageViewer.tsx), tied to
// the browser's history so Back closes it (mw-jtzpw0.5).
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ShownPicture {
  src: string;
  name?: string;
}

/** What the history entry the viewer pushed carries (a number of its own), so Back can tell it from any other. */
type ViewerEntry = { viewer?: number } | null;

let lastEntry = 0;

function viewerEntry(): number | undefined {
  return (window.history.state as ViewerEntry)?.viewer;
}

/**
 * The picture a screen is showing full screen, if any. Opening it pushes a history entry on the
 * same address, so Back (the phone's too) closes it instead of leaving the screen under it.
 */
export function useViewer() {
  const [shown, setShown] = useState<ShownPicture>();
  // the history entry this viewer pushed
  const entry = useRef<number>(undefined);
  const open = useCallback((picture: ShownPicture) => {
    entry.current = ++lastEntry;
    window.history.pushState({ ...(window.history.state as object | null), viewer: entry.current }, '');
    setShown(picture);
  }, []);
  const close = useCallback(() => {
    // Back does the closing (the popstate below), so the entry the viewer pushed is let go too
    if (entry.current !== undefined && viewerEntry() === entry.current) window.history.back();
    else setShown(undefined);
  }, []);
  const isOpen = shown !== undefined;
  useEffect(() => {
    if (!isOpen) return;
    const onPop = () => {
      if (viewerEntry() !== entry.current) setShown(undefined);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOpen]);
  return { shown, open, close };
}
