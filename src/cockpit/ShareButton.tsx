// src/cockpit/ShareButton.tsx — mw-gq6.252: Share on a message or card. Where the phone has a
// share sheet (navigator.share) a tap opens it with the text and a title naming the channel, so
// he can pick Messages, Gmail and so on; where it has none the tap copies the text and the button
// says Copied. Backing out of the sheet is not a failure and says nothing.
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../ui/copyText';
import { Icon, cx } from '../ui';

type ShareState = 'idle' | 'copied' | 'failed';

/** Opens the share sheet; false when there is none (or it refused the text), true when it took it or he backed out. */
async function viaShareSheet(data: { title: string; text: string }): Promise<boolean> {
  if (typeof navigator.share !== 'function') return false;
  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare(data)) return false;
    await navigator.share(data);
    return true;
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError';
  }
}

export function ShareButton({ title, text, className }: { title: string; text: string; className?: string }) {
  const [state, setState] = useState<ShareState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function say(next: ShareState) {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  function share() {
    void viaShareSheet({ title, text })
      .then((handled) => (handled ? undefined : copyText(text).then((ok) => say(ok ? 'copied' : 'failed'))));
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Share';
  return (
    <button type="button" onClick={share} className={cx('inline-flex items-center gap-1 rounded px-1 font-semibold hover:text-fg', state === 'failed' ? 'text-danger' : 'text-muted', className)}>
      {state === 'idle' && <Icon name="share" size={12} />}
      {label}
    </button>
  );
}
