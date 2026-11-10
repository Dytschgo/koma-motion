import type { ComponentPropsWithRef, ReactElement } from 'react';
import { join } from './internal';

export function SearchIcon({ size = 16 }: { readonly size?: number }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="flex-none text-ink-400"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

/**
 * A search box with its icon. `bare` sits in the header of a popover, divided
 * by a line; `field` stands alone in a panel like the other inputs.
 */
export function SearchField({
  variant = 'field',
  className,
  ...rest
}: Omit<ComponentPropsWithRef<'input'>, 'type'> & {
  readonly variant?: 'field' | 'bare';
}): ReactElement {
  return (
    <div
      className={join(
        'flex min-w-0 items-center gap-2',
        variant === 'field' &&
          'min-h-9 rounded-control border border-line-strong bg-surface-0 px-2.5 transition-[border-color,box-shadow] duration-150 ease-standard focus-within:border-accent focus-within:shadow-[0_0_0_3px_oklch(62%_0.17_35/0.16)] hover:border-ink-400/70',
        className,
      )}
    >
      <SearchIcon />
      <input
        type="search"
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink-100 placeholder:text-ink-400 focus-visible:outline-none"
        {...rest}
      />
    </div>
  );
}
