/** Small building blocks of the interface. They contain no application logic. */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

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
    'border border-[#a4dcf5] bg-pencil-blue text-desk-950 font-semibold shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_2px_10px_rgb(14_87_123/0.2)] hover:bg-[#a4d8f0] disabled:border-desk-600 disabled:bg-desk-600 disabled:text-ink-400 disabled:shadow-none',
  quiet:
    'text-ink-300 hover:bg-desk-700 hover:text-ink-100 disabled:text-desk-500 disabled:hover:bg-transparent',
  outline:
    'border border-desk-500 bg-desk-800/70 text-ink-100 shadow-[0_1px_0_rgb(255_255_255/0.04)_inset] hover:border-pencil-blue/60 hover:bg-desk-700 disabled:border-desk-600 disabled:bg-transparent disabled:text-desk-500 disabled:shadow-none disabled:hover:bg-transparent',
  danger:
    'border border-[#f58d7c] bg-pencil-red text-desk-950 font-semibold hover:bg-[#f48673] disabled:border-desk-600 disabled:bg-desk-600 disabled:text-ink-400',
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
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md whitespace-nowrap',
        'transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed',
        compact ? 'px-2' : 'px-3.5',
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
        'inline-flex size-9 flex-none items-center justify-center rounded-md transition-[background-color,color] duration-150',
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

/** Short help that remains available to pointer and keyboard users. */
export function Help({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const open = !dismissed && (hovered || focused || pinned);

  useEffect(() => {
    if (!open) return;
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setPinned(false);
      setFocused(false);
      setHovered(false);
      setDismissed(true);
    };
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => document.removeEventListener('keydown', dismissOnEscape, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const dismissHidden = (): void => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      setPinned(false);
      setFocused(false);
      setHovered(false);
      setDismissed(true);
    };
    const updatePosition = (): void => {
      const button = trigger.current;
      const panel = tooltip.current;
      if (button === null || panel === null) return;
      const bounds = button.getBoundingClientRect();
      if (
        !button.isConnected ||
        button.getClientRects().length === 0 ||
        bounds.width === 0 ||
        bounds.height === 0 ||
        getComputedStyle(button).visibility !== 'visible'
      ) {
        dismissHidden();
        return;
      }
      const { width, height } = panel.getBoundingClientRect();
      const left = Math.max(16, Math.min(bounds.right - width, window.innerWidth - width - 16));
      const top =
        bounds.bottom + height + 8 <= window.innerHeight - 16
          ? bounds.bottom + 8
          : Math.max(16, bounds.top - height - 8);
      setPosition({ top, left });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (trigger.current !== null) observer.observe(trigger.current);
    if (tooltip.current !== null) observer.observe(tooltip.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!pinned) return;
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !tooltip.current?.contains(event.target)
      ) {
        setPinned(false);
        setFocused(false);
        setHovered(false);
        setDismissed(true);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [pinned]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className={join(
          'inline-flex size-6 flex-none items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-desk-700 hover:text-pencil-blue focus:text-pencil-blue',
          className,
        )}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') {
            if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
            setDismissed(false);
            setHovered(true);
          }
        }}
        onPointerLeave={() => {
          leaveTimer.current = setTimeout(() => setHovered(false), 120);
        }}
        onFocus={() => {
          setDismissed(false);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setFocused(false);
            setHovered(false);
            setDismissed(true);
          } else {
            setDismissed(false);
            setPinned(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setPinned(false);
            setFocused(false);
            setHovered(false);
            setDismissed(true);
          }
        }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            id={id}
            role="tooltip"
            className="fixed z-[100] max-h-[min(12rem,calc(100vh-32px))] w-[min(280px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-desk-500 bg-desk-700 px-3 py-2 text-sm leading-relaxed text-ink-100 shadow-[0_12px_32px_rgb(0_0_0/0.38)]"
            style={{ top: position.top, left: position.left }}
            onPointerEnter={() => {
              if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
              setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

const CONTROL =
  'rounded-md border border-desk-500 bg-desk-950/80 px-2.5 text-ink-100 shadow-[0_1px_2px_rgb(0_0_0/0.18)_inset] placeholder:text-ink-400 ' +
  'transition-[border-color,background-color,box-shadow] duration-150 hover:border-ink-400 focus:border-pencil-blue focus:bg-desk-900 ' +
  'disabled:cursor-not-allowed disabled:border-desk-600 disabled:bg-desk-900 disabled:text-ink-400 disabled:hover:border-desk-600 ' +
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
  ...rest
}: ComponentPropsWithRef<'textarea'>): ReactElement {
  return (
    <textarea
      rows={rows}
      className={join(CONTROL, 'resize-none py-2 leading-relaxed', withDefaultWidth(className))}
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
    <select
      className={join(CONTROL, 'studio-select min-h-9 pr-8', withDefaultWidth(className))}
      {...rest}
    >
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
      className={join(CONTROL, 'min-h-9 tabular-nums', withDefaultWidth(className))}
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
