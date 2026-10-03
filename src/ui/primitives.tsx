// src/ui/primitives.tsx — the cockpit's small building blocks. Every screen is
// made of these, so a button, a chip or a card looks and behaves the same
// wherever it appears (plans/0021, decision 9).
import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { relativeTime } from '../services/age';
import { cx, TONE_DOT, type Tone } from './tokens';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 font-semibold',
  secondary: 'bg-raised text-fg border border-line hover:border-line-strong active:bg-sunken',
  ghost: 'text-muted hover:text-fg hover:bg-raised active:bg-sunken',
  danger: 'bg-transparent text-danger border border-danger/50 hover:bg-danger/10',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
};

/** The sizes of a `wrap` button: no fixed height, so a long label wraps and the button grows. */
const WRAP_SIZES: Record<ButtonSize, string> = {
  sm: 'h-auto min-h-8 py-1.5 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-auto min-h-10 py-2 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-auto min-h-12 py-2.5 px-5 text-base gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  busy?: boolean;
  /** A long label: the button is as wide as its box, the words wrap, and it grows taller instead of wider. */
  wrap?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, busy, wrap, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center transition-[filter,background-color,border-color,color] duration-150 select-none',
        wrap ? 'w-full min-w-0 justify-start text-left break-words whitespace-normal' : 'shrink-0 justify-center whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        wrap ? WRAP_SIZES[size] : SIZES[size],
        className,
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  tone?: 'default' | 'accent' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  pressed?: boolean;
}

export function IconButton({ icon, label, tone = 'default', size = 'md', pressed, className, ...props }: IconButtonProps) {
  const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const toneClass =
    tone === 'accent'
      ? 'bg-accent text-accent-fg hover:brightness-110'
      : tone === 'danger'
        ? 'text-danger hover:bg-danger/10'
        : pressed
          ? 'bg-raised text-fg'
          : 'text-muted hover:text-fg hover:bg-raised';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40', box, toneClass, className)}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 22 : 20} />
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}


const TONES: Record<Tone, string> = {
  needs: 'text-needs bg-needs/12 border-needs/30',
  working: 'text-working bg-working/12 border-working/30',
  ready: 'text-ready bg-ready/12 border-ready/30',
  blocked: 'text-blocked bg-blocked/12 border-blocked/30',
  held: 'text-held bg-held/12 border-held/30',
  done: 'text-done bg-done/12 border-done/30',
  neutral: 'text-muted bg-raised border-line',
  danger: 'text-danger bg-danger/12 border-danger/30',
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: IconName;
  mono?: boolean;
  /** Let a long text wrap inside the chip instead of being cut off with an ellipsis. */
  wrap?: boolean;
}

export function Chip({ tone = 'neutral', icon, mono, wrap, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] leading-4 font-medium',
        mono && 'font-mono',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={12} strokeWidth={2.2} className="shrink-0" />}
      <span className={wrap ? 'min-w-0 break-words' : 'min-w-0 truncate'}>{children}</span>
    </span>
  );
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden="true" className={cx('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-2 px-1', className)}>
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-faint uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-muted">
        <Icon name={icon} size={24} />
      </span>
      <p className="text-base font-semibold text-fg">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** A time as "3 min ago", refreshed every half-minute, with the full time on hover. */
export function TimeAgo({ at, className }: { at: string | number | Date | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (at === undefined || at === '') return null;
  const date = at instanceof Date ? at : typeof at === 'number' ? new Date(at < 1e12 ? at * 1000 : at) : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className}>
      {relativeTime(date, new Date(now))}
    </time>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex rounded-xl border border-line bg-sunken p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition-colors',
              active ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {option.icon && <Icon name={option.icon} size={16} />}
            {option.label}
            {option.count !== undefined && <span className="text-faint tabular-nums">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Banner({ tone = 'neutral', icon, children, action }: { tone?: Tone; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className={cx('flex items-center gap-3 rounded-xl border px-3 py-2 text-sm', TONES[tone])}>
      {icon && <Icon name={icon} size={18} />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
