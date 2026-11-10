import { useId, type ReactElement, type ReactNode } from 'react';
import { join } from './internal';

export interface FieldProps {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly className?: string;
  /** Receives the ids that connect the control with its label and messages. */
  readonly children: (ids: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}

export function Field({ label, error, hint, className, children }: FieldProps): ReactElement {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={join('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-300">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': message === undefined ? undefined : messageId,
        'aria-invalid': error === undefined ? undefined : true,
      })}
      {message !== undefined && (
        <p
          id={messageId}
          role={error === undefined ? undefined : 'alert'}
          className={join('text-sm', error === undefined ? 'text-ink-400' : 'text-motion')}
        >
          {error !== undefined && 'Error: '}
          {message}
        </p>
      )}
    </div>
  );
}
