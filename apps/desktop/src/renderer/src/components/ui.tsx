/** Small building blocks of the interface. They contain no application logic. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

function join(...classes: readonly (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Controls fill their container unless the caller sets a width. */
function withDefaultWidth(className: string | undefined): string {
  return className !== undefined && /(^|\s)w-/.test(className)
    ? className
    : join('w-full', className);
}

const BUTTON_VARIANTS = {
  primary:
    'bg-pencil-blue text-desk-950 font-semibold hover:bg-[#93d0ee] disabled:bg-desk-600 disabled:text-ink-400',
  quiet: 'text-ink-100 hover:bg-desk-700 disabled:text-desk-500 disabled:hover:bg-transparent',
  outline:
    'border border-desk-600 text-ink-100 hover:border-desk-500 hover:bg-desk-700 disabled:text-desk-500 disabled:hover:bg-transparent',
  danger:
    'bg-pencil-red text-desk-950 font-semibold hover:bg-[#f48673] disabled:bg-desk-600 disabled:text-ink-400',
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
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md whitespace-nowrap',
        'transition-colors disabled:cursor-not-allowed',
        compact ? 'px-2' : 'px-3',
        active ? 'bg-desk-700 text-pencil-blue' : BUTTON_VARIANTS[variant],
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
  default: 'text-ink-300 hover:bg-desk-700 hover:text-ink-100',
  motion: 'bg-pencil-red-deep text-pencil-red hover:bg-pencil-red hover:text-desk-950',
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
        'inline-flex size-8 flex-none items-center justify-center rounded-md transition-colors',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-desk-500',
        'disabled:hover:bg-transparent disabled:hover:text-desk-500',
        active ? 'bg-desk-700 text-pencil-blue' : ICON_BUTTON_TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const CONTROL =
  'rounded-md border border-desk-600 bg-desk-900 px-2 text-ink-100 placeholder:text-ink-400 ' +
  'hover:border-desk-500 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:border-desk-600 ' +
  'aria-invalid:border-pencil-red';

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
      <label htmlFor={id} className="text-sm text-ink-300">
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
          className={join('text-sm', error === undefined ? 'text-ink-400' : 'text-pencil-red')}
        >
          {error !== undefined && 'Error: '}
          {message}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <input type="text" className={join(CONTROL, 'h-8', withDefaultWidth(className))} {...rest} />
  );
}

export function TextArea({
  className,
  rows = 3,
  ...rest
}: ComponentPropsWithRef<'textarea'>): ReactElement {
  return (
    <textarea
      rows={rows}
      className={join(CONTROL, 'resize-none py-1.5', withDefaultWidth(className))}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return (
    <select className={join(CONTROL, 'h-8', withDefaultWidth(className))} {...rest}>
      {children}
    </select>
  );
}

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
      className={join(CONTROL, 'h-8 tabular-nums', withDefaultWidth(className))}
      value={text}
      aria-invalid={valid ? undefined : true}
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
    />
  );
}

export function PanelHeading({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex h-9 items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-ink-100">{children}</h2>
      {action}
    </div>
  );
}

export interface ModalProps {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'narrow' | 'wide';
}

/** A modal dialog. Focus stays inside it and Escape closes it. */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width = 'narrow',
}: ModalProps): ReactElement {
  const reference = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = reference.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={reference}
      aria-labelledby={titleId}
      className={join(
        'm-auto max-h-[85vh] max-w-[calc(100vw-2rem)] rounded-xl border border-desk-600 bg-desk-800 p-0 text-ink-100',
        'shadow-[0_24px_80px_rgb(0_0_0/0.55)]',
        width === 'narrow' ? 'w-[440px]' : 'w-[640px]',
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <h2 id={titleId} className="px-6 pt-5 text-xl font-semibold">
            {title}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer !== undefined && (
            <div className="flex justify-end gap-2 border-t border-desk-600 px-6 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
