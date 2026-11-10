import type { ReactElement, ReactNode } from 'react';
import { join } from './internal';

/*
 * The vocabulary of the chat composer, shared by every panel: floating
 * surfaces, segmented tabs, choice rows with an icon tile, and tinted badges.
 */

/** A menu, picker or popover that floats above a panel. */
export const POPOVER_SURFACE = 'rounded-card border border-line-strong bg-surface-2 shadow-popover';

/** The row of a segmented tab list. Pair each tab with `segmentClass`. */
export const SEGMENT_TRACK = 'grid auto-cols-fr grid-flow-col gap-1';

export function segmentClass(selected: boolean): string {
  return join(
    'relative flex min-h-8 items-center justify-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-standard',
    selected ? 'bg-surface-3 text-ink-100' : 'text-ink-400 hover:text-ink-100',
  );
}

/** A row that can be chosen from a list. The chosen row carries the accent tint. */
export function choiceRowClass(selected: boolean): string {
  return join(
    'rounded-control transition-colors duration-150 ease-standard',
    selected ? 'bg-accent-deep' : 'hover:bg-surface-3',
  );
}

/** The square that holds the logo, icon or initial at the start of a choice row. */
export function IconTile({
  size = 'md',
  className,
  children,
}: {
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={join(
        'flex flex-none items-center justify-center rounded-control border border-line bg-surface-3',
        size === 'sm' ? 'size-6' : 'size-7',
        className,
      )}
    >
      {children}
    </span>
  );
}

const BADGE_TONES = {
  neutral: 'bg-surface-3 text-ink-300',
  accent: 'bg-accent-deep text-accent',
  ok: 'bg-signal-ok/12 text-signal-ok',
  warn: 'bg-signal-warn/12 text-signal-warn',
} as const;

/** A short status or scope label. */
export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: keyof typeof BADGE_TONES;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      className={join(
        'inline-flex h-5 flex-none items-center rounded-full px-2 text-xs font-medium whitespace-nowrap',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
