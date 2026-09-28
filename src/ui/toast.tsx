// src/ui/toast.tsx — short confirmations and failures that float above whatever
// screen is showing ("Released mw-abc", "Could not reach the desktop"), so a
// one-tap action always says what happened without moving him anywhere.
import { useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { subscribeToasts, currentToasts } from './toastStore';
import { cx } from './tokens';

export function ToastHost() {
  const current = useSyncExternalStore(subscribeToasts, currentToasts, currentToasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {current.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur',
            t.tone === 'error' ? 'border-danger/40 bg-surface text-danger' : 'border-line bg-raised text-fg',
          )}
        >
          <Icon name={t.tone === 'error' ? 'alarm' : 'check'} size={16} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
