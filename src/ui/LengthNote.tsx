// src/ui/LengthNote.tsx — mw-gq6.464: the count under a text box with a limit. Near the limit it reads 'N of M' in grey;
// past it, in red and with the reason, so the Send it points at (aria-describedby) can be off and say why. Nothing is cut.
import { isTooLong, LENGTH_NEAR, sentLength } from './lengthLimit';
import { cx } from './tokens';

export function LengthNote({ id, text, max, what, testId, className }: {
  id: string;
  text: string;
  max: number;
  /** What is too long, for the reason: 'call request'. */
  what: string;
  testId?: string;
  className?: string;
}) {
  const length = sentLength(text);
  if (length <= max * LENGTH_NEAR) return null;
  const over = isTooLong(text, max);
  return (
    <p id={id} role="status" data-testid={testId} className={cx('break-words text-[12.5px]', over ? 'font-medium text-danger' : 'text-muted', className)}>
      {length} of {max}
      {over ? `: the ${what} is too long to send. Shorten it; nothing has been cut.` : ''}
    </p>
  );
}
