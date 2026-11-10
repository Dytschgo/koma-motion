/** Helpers shared by the controls in this folder. Not part of the `ui` exports. */

export function join(...classes: readonly (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Controls fill their container unless the caller sets a width. */
export function withDefaultWidth(className: string | undefined): string {
  return className !== undefined && /(^|\s)w-/.test(className)
    ? className
    : join('w-full', className);
}

export const CONTROL =
  'rounded-control border border-line-strong bg-surface-0 px-2.5 text-ink-100 shadow-[inset_0_1px_2px_oklch(30%_0.02_60/0.06)] placeholder:text-ink-400 ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ease-standard hover:border-ink-400/70 focus:border-accent focus:shadow-[0_0_0_3px_oklch(62%_0.17_35/0.16)] ' +
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-1 disabled:text-ink-400 disabled:hover:border-line ' +
  'aria-invalid:border-motion';
