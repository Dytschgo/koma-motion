import type { InputHTMLAttributes, ReactElement } from 'react';
import { join } from './internal';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'role' | 'onChange'
> {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

/** An on/off control. It is a checkbox with the switch role, so labels and forms work as usual. */
export function Switch({
  checked,
  onCheckedChange,
  className,
  ...rest
}: SwitchProps): ReactElement {
  return (
    <input
      type="checkbox"
      role="switch"
      className={join('studio-switch', className)}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...rest}
    />
  );
}
