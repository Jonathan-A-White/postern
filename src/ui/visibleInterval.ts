// src/ui/visibleInterval.ts — setInterval that sleeps while the page is hidden (mw-xhtcup.1).
// It does not tick in the background, and fires fn once when the page is visible again, then
// carries on every `ms`. Started while hidden it starts stopped. Returns the stop function.
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    if (timer === undefined) timer = setInterval(fn, ms);
  };
  const halt = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const onChange = () => {
    if (document.visibilityState === 'hidden') {
      halt();
    } else {
      halt();
      fn();
      run();
    }
  };
  if (document.visibilityState !== 'hidden') run();
  document.addEventListener('visibilitychange', onChange);
  return () => {
    halt();
    document.removeEventListener('visibilitychange', onChange);
  };
}
