import type { ReactElement, SelectHTMLAttributes } from 'react';
import { CONTROL, join, withDefaultWidth } from './internal';

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return (
    <select
      className={join(CONTROL, 'studio-select min-h-9 pr-8', withDefaultWidth(className))}
      {...rest}
    >
      {children}
    </select>
  );
}
