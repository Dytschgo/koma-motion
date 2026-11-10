import { parseColour } from '@koma-motion/core';
import type { ReactElement } from 'react';
import { Field, TextInput } from './ui';

/** One visual picker and an optional exact value, shared by all colour editors. */
export function ColourControl({
  label,
  value,
  onValue,
  disabled = false,
  error,
  onFocus,
  onBlur,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly onFocus?: (() => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
}): ReactElement {
  const parsed = parseColour(value);
  return (
    <Field label={label} error={error}>
      {(ids) => (
        <div className="colour-control">
          {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is global in ARIA 1.3 and exposed by Chromium; the rule's data stops at ARIA 1.2. */}
          <input
            type="color"
            aria-label="Colour picker"
            aria-description={label}
            title={`Choose ${label.toLowerCase()}`}
            className="colour-picker"
            value={parsed.ok ? parsed.value : '#000000'}
            disabled={disabled}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(event) => onValue(event.target.value.toUpperCase())}
          />
          <TextInput
            {...ids}
            className="min-w-0 flex-1 font-mono text-xs"
            value={value}
            disabled={disabled}
            spellCheck={false}
            placeholder="#RRGGBB"
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(event) => onValue(event.target.value)}
          />
        </div>
      )}
    </Field>
  );
}
