// src/ui/CodeBlock.tsx — mw-gq6.176: the one code block. A <pre> with a Copy
// button in its top-right corner that copies the block's exact text.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from './copyText';
import { cx } from './tokens';

type CopyState = 'idle' | 'copied' | 'failed';

export interface CodeBlockProps {
  /** The exact text copied. */
  text: string;
  /** Classes for the <pre>; the block keeps the caller's wrapping and colours. */
  className?: string;
  children?: ReactNode;
}

export function CodeBlock({ text, className, children }: CodeBlockProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy() {
    void copyText(text).then((ok) => {
      setState(ok ? 'copied' : 'failed');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    });
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy';
  return (
    <div className="relative">
      <pre className={cx('pt-9', className)}>{children ?? text}</pre>
      <button
        type="button"
        onClick={copy}
        className={cx(
          'absolute top-1.5 right-1.5 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] font-medium hover:text-fg',
          state === 'failed' ? 'text-danger' : 'text-muted',
        )}
      >
        {label}
      </button>
    </div>
  );
}
