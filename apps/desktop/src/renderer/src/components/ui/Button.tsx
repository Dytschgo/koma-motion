import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { join } from './internal';

const BUTTON_VARIANTS = {
  primary:
    'bg-accent text-surface-0 font-semibold shadow-raised hover:bg-accent-hover disabled:bg-surface-3 disabled:text-ink-400 disabled:shadow-none',
  quiet:
    'text-ink-300 hover:bg-surface-3 hover:text-ink-100 disabled:text-line-strong disabled:hover:bg-transparent',
  outline:
    'border border-line-strong bg-surface-2 text-ink-100 shadow-raised hover:border-ink-400/60 hover:bg-surface-3 disabled:border-line disabled:bg-transparent disabled:text-line-strong disabled:shadow-none disabled:hover:bg-transparent',
  danger:
    'bg-motion text-surface-0 font-semibold shadow-raised hover:bg-accent-hover disabled:bg-surface-3 disabled:text-ink-400 disabled:shadow-none',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof BUTTON_VARIANTS;
  readonly icon?: ReactNode;
  /** Less horizontal padding, for buttons that hold a single character. */
  readonly compact?: boolean;
  /** Marks the button of the view or mode that is shown. */
  readonly active?: boolean;
}

export function Button({
  variant = 'quiet',
  icon,
  compact = false,
  active = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={join(
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-control whitespace-nowrap',
        'transition-[background-color,border-color,color,box-shadow] duration-150 ease-standard disabled:cursor-not-allowed',
        compact ? 'px-2' : 'px-3.5',
        active ? 'bg-surface-3 text-accent' : BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Also shown as a tooltip. */
  readonly label: string;
  readonly active?: boolean;
  /** `motion` marks the control that starts playback. */
  readonly tone?: 'default' | 'motion';
}

const ICON_BUTTON_TONES = {
  default: 'text-ink-300 hover:bg-surface-3 hover:text-ink-100',
  motion: 'bg-motion-deep text-motion hover:bg-motion hover:text-surface-0',
} as const;

export function IconButton({
  label,
  active = false,
  tone = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={join(
        'inline-flex size-9 flex-none items-center justify-center rounded-control transition-[background-color,color] duration-150 ease-standard',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-line-strong',
        'disabled:hover:bg-transparent disabled:hover:text-line-strong',
        active ? 'bg-surface-3 text-accent' : ICON_BUTTON_TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
