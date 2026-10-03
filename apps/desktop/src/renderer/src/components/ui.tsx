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
    'bg-accent text-surface-0 font-semibold shadow-raised hover:bg-accent-hover disabled:bg-surface-3 disabled:text-ink-400 disabled:shadow-none',
  quiet:
    'text-ink-300 hover:bg-surface-3 hover:text-ink-100 disabled:text-line-strong disabled:hover:bg-transparent',
  outline:
    'border border-line-strong bg-surface-2 text-ink-100 shadow-raised hover:border-ink-400/60 hover:bg-surface-3 disabled:border-line disabled:bg-transparent disabled:text-line-strong disabled:shadow-none disabled:hover:bg-transparent',
  danger:
    'bg-motion text-surface-0 font-semibold shadow-raised hover:bg-[#f48673] disabled:bg-surface-3 disabled:text-ink-400 disabled:shadow-none',
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
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-control whitespace-nowrap',
        'transition-[background-color,border-color,color,box-shadow] duration-150 ease-standard disabled:cursor-not-allowed',
        compact ? 'px-2' : 'px-3.5',
        active ? 'bg-surface-3 text-accent' : BUTTON_VARIANTS[variant],
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
  default: 'text-ink-300 hover:bg-surface-3 hover:text-ink-100',
  motion: 'bg-motion-deep text-motion hover:bg-motion hover:text-surface-0',
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
        'inline-flex size-9 flex-none items-center justify-center rounded-control transition-[background-color,color] duration-150 ease-standard',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-line-strong',
        'disabled:hover:bg-transparent disabled:hover:text-line-strong',
        active ? 'bg-surface-3 text-accent' : ICON_BUTTON_TONES[tone],
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
          'inline-flex size-6 flex-none items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-3 hover:text-accent focus:text-accent',
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
            className="fixed z-[100] max-h-[min(12rem,calc(100vh-32px))] w-[min(280px,calc(100vw-32px))] overflow-y-auto rounded-card border border-line-strong bg-surface-3 px-3 py-2 text-sm leading-relaxed text-ink-100 shadow-popover"
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
  'rounded-control border border-line-strong bg-surface-0 px-2.5 text-ink-100 shadow-[0_1px_2px_rgb(0_0_0/0.2)_inset] placeholder:text-ink-400 ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ease-standard hover:border-ink-400/70 focus:border-accent focus:shadow-[0_0_0_3px_rgb(124_196_232/0.16)] ' +
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-1 disabled:text-ink-400 disabled:hover:border-line ' +
  'aria-invalid:border-motion';

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

/*
 * The vocabulary of the chat composer, shared by every panel: floating
 * surfaces, segmented tabs, choice rows with an icon tile, and tinted badges.
 */

/** A menu, picker or popover that floats above a panel. */
export const POPOVER_SURFACE = 'rounded-card border border-line-strong bg-surface-2 shadow-popover';

/** The row of a segmented tab list. Pair each tab with `segmentClass`. */
export const SEGMENT_TRACK = 'grid auto-cols-fr grid-flow-col gap-1';

export function segmentClass(selected: boolean): string {
  return join(
    'relative flex min-h-8 items-center justify-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-standard',
    selected ? 'bg-surface-3 text-ink-100' : 'text-ink-400 hover:text-ink-100',
  );
}

/** A row that can be chosen from a list. The chosen row carries the accent tint. */
export function choiceRowClass(selected: boolean): string {
  return join(
    'rounded-control transition-colors duration-150 ease-standard',
    selected ? 'bg-accent-deep' : 'hover:bg-surface-3',
  );
}

/** The square that holds the logo, icon or initial at the start of a choice row. */
export function IconTile({
  size = 'md',
  className,
  children,
}: {
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={join(
        'flex flex-none items-center justify-center rounded-control border border-line bg-surface-3',
        size === 'sm' ? 'size-6' : 'size-7',
        className,
      )}
    >
      {children}
    </span>
  );
}

const BADGE_TONES = {
  neutral: 'bg-surface-3 text-ink-300',
  accent: 'bg-accent-deep text-accent',
  ok: 'bg-signal-ok/12 text-signal-ok',
  warn: 'bg-signal-warn/12 text-signal-warn',
} as const;

/** A short status or scope label. */
export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: keyof typeof BADGE_TONES;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      className={join(
        'inline-flex h-5 flex-none items-center rounded-full px-2 text-xs font-medium whitespace-nowrap',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

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
          'min-h-9 rounded-control border border-line-strong bg-surface-0 px-2.5 transition-[border-color,box-shadow] duration-150 ease-standard focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(124_196_232/0.16)] hover:border-ink-400/70',
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

export interface ModalFrameProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Id of the element that names the dialog. */
  readonly labelledBy: string;
  /** Selector inside the dialog to focus after it opens. Other dialogs use native focus. */
  readonly initialFocus?: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The native modal dialog without a layout. Focus stays inside it, Escape
 * closes it and focus returns to the control that opened it.
 */
export function ModalFrame({
  open,
  onClose,
  labelledBy,
  initialFocus,
  className,
  children,
}: ModalFrameProps): ReactElement {
  const reference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = reference.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus !== undefined) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  return (
    <dialog
      ref={reference}
      aria-labelledby={labelledBy}
      className={join(
        'm-auto max-h-[85vh] max-w-[calc(100vw-2rem)] rounded-dialog border border-line-strong bg-surface-2 p-0 text-ink-100 shadow-dialog',
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export interface ModalProps {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'narrow' | 'wide';
  readonly initialFocus?: string | undefined;
}

/** A modal dialog with a title, a scrolling body and a footer. */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width = 'narrow',
  initialFocus,
}: ModalProps): ReactElement {
  const titleId = useId();

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      initialFocus={initialFocus}
      className={width === 'narrow' ? 'w-[440px]' : 'w-[640px]'}
    >
      <div className="flex max-h-[85vh] flex-col">
        <h2
          id={titleId}
          className="border-b border-line px-6 pt-5 pb-4 text-lg font-semibold tracking-tight"
        >
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-line px-6 py-3">{footer}</div>
        )}
      </div>
    </ModalFrame>
  );
}

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

/**
 * One setting: its name and an explanation on the left, the control on the
 * right. `children` receives the ids that connect the control with the text.
 */
export function SettingRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description?: ReactNode;
  readonly children: (ids: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}): ReactElement {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex min-w-0 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-medium text-ink-100">
          {label}
        </label>
        {description !== undefined && (
          <p id={descriptionId} className="mt-0.5 text-sm leading-relaxed text-ink-400">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center">
        {children({
          id,
          'aria-describedby': description === undefined ? undefined : descriptionId,
        })}
      </div>
    </div>
  );
}

/** A titled group of settings on a card. */
export function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-card border border-line bg-surface-1/70 px-4 pt-3.5 pb-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={id} className="font-semibold text-ink-100">
            {title}
          </h4>
          {description !== undefined && (
            <p className="mt-0.5 text-sm leading-relaxed text-ink-400">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}
