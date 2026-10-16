// src/ui/useAlive.ts — whether the component is still on screen (mw-ev7oyy.21). Work a handler starts
// (a copy, a send, a chain read) can answer after the screen has closed; the handler asks alive() after
// each await before it sets state, and drops the answer when the screen is gone. React ignores a set on
// a closed screen, but in a test it can land after the page is torn down, where it throws 'window is not
// defined' and fails a green run. An effect uses its own `cancelled` flag in its cleanup instead.
// alive() is true from the first render (a child's mount effect, which runs before this one, may call
// a handler), false once unmounted, and true again when StrictMode mounts the component a second time.
import { useCallback, useEffect, useRef } from 'react';

export function useAlive(): () => boolean {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useCallback(() => alive.current, []);
}
