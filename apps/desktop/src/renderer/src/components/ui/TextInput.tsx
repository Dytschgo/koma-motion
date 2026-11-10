import type { ComponentPropsWithRef, ReactElement } from 'react';
import { CONTROL, join, withDefaultWidth } from './internal';

export function TextInput({ className, ...rest }: ComponentPropsWithRef<'input'>): ReactElement {
  return (
    <input
      type="text"
      className={join(CONTROL, 'min-h-9', withDefaultWidth(className))}
      {...rest}
    />
  );
}

export function TextArea({
  className,
  rows = 3,
  style,
  ...rest
}: ComponentPropsWithRef<'textarea'>): ReactElement {
  // The field grows with its text, so a line is never cut in half; `rows`
  // is the smallest height and a long text scrolls past twelve lines.
  return (
    <textarea
      rows={rows}
      className={join(
        CONTROL,
        'field-sizing-content max-h-[calc(12lh+1rem+2px)] resize-none py-2 leading-relaxed',
        withDefaultWidth(className),
      )}
      style={{ minHeight: `calc(${String(rows)}lh + 1rem + 2px)`, ...style }}
      {...rest}
    />
  );
}
