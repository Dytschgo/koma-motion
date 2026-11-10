import { useState, type InputHTMLAttributes, type ReactElement } from 'react';
import { CONTROL, join, withDefaultWidth } from './internal';

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  readonly value: number;
  readonly minimum?: number;
  readonly maximum?: number;
  /** Decimal places shown. */
  readonly precision?: number;
  /** Called with every valid number that is entered. */
  readonly onValue: (value: number) => void;
}

function format(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

/**
 * A number field that tolerates unfinished input. While the text is not a
 * valid number within the limits, nothing is reported and the field is
 * marked invalid; leaving the field restores the last valid value.
 */
export function NumberInput({
  value,
  minimum = -Infinity,
  maximum = Infinity,
  precision = 2,
  onValue,
  className,
  'aria-invalid': invalid,
  ...rest
}: NumberInputProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? format(value, precision);
  const parsed = Number(text.replace(',', '.'));
  const valid =
    text.trim() !== '' && Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum;

  return (
    <input
      type="text"
      inputMode="decimal"
      className={join(CONTROL, 'min-h-9 tabular-nums', withDefaultWidth(className))}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const number = Number(next.replace(',', '.'));
        if (
          next.trim() !== '' &&
          Number.isFinite(number) &&
          number >= minimum &&
          number <= maximum
        ) {
          onValue(number);
        }
      }}
      onBlur={() => {
        setDraft(null);
      }}
      {...rest}
      // A surrounding `Field` passes `aria-invalid` too. Its value counts only
      // while the text is a usable number.
      aria-invalid={valid ? invalid : true}
    />
  );
}
