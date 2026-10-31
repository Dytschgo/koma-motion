import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  readonly label: string;
  /** Shown at the end of the row, for example a keyboard shortcut. */
  readonly hint?: string;
  readonly icon?: ReactNode;
  /** A state read after the label, for example whether project instructions are active. */
  readonly description?: string;
  readonly disabled?: boolean;
  /** Draws a divider above the item. */
  readonly separated?: boolean;
  readonly action: () => void;
}

/** Keeps a floating surface inside the window, below or above its anchor. */
export function placeBeside(
  anchor: DOMRect,
  size: { readonly width: number; readonly height: number },
  align: 'start' | 'end',
  margin = 8,
): { readonly x: number; readonly y: number } {
  const preferredX = align === 'end' ? anchor.right - size.width : anchor.left;
  const x = Math.max(margin, Math.min(preferredX, innerWidth - size.width - margin));
  const below = anchor.bottom + 6;
  const above = anchor.top - size.height - 6;
  const y =
    below + size.height <= innerHeight - margin || above < margin
      ? Math.max(margin, Math.min(below, innerHeight - size.height - margin))
      : above;
  return { x, y };
}

/** Moves focus between the enabled items of a menu with the arrow keys, Home and End. */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const choices = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
  ];
  const current = choices.findIndex((button) => button === document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? choices.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % choices.length
          : current <= 0
            ? choices.length - 1
            : current - 1;
  choices[next]?.focus();
}

/**
 * A menu that opens from a button. It closes on Escape, Tab, a choice or a
 * press outside, and returns focus to its button when the keyboard closed it.
 */
export function MenuButton({
  label,
  items,
  children,
  align = 'start',
  className,
  menuLabel,
  disabled,
  title,
  guideTarget,
  ...rest
}: {
  /** Accessible name of the button. */
  readonly label: string;
  /** Lets Getting started move focus to this button. */
  readonly guideTarget?: string;
  readonly items: readonly MenuItem[];
  /** Content of the button: an icon, text or both. */
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  readonly className?: string;
  /** Accessible name of the menu; the button's name by default. */
  readonly menuLabel?: string;
  readonly disabled?: boolean;
  readonly title?: string;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-keyshortcuts' | 'aria-description' | 'id'
>): ReactElement {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || button.current === null || menu.current === null) return;
    const rect = menu.current.getBoundingClientRect();
    setPosition(placeBeside(button.current.getBoundingClientRect(), rect, align));
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      )
        close(false);
    };
    const dismiss = (): void => close(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        data-guide-target={guideTarget}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        className={className}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        {...rest}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={menuLabel ?? label}
            className="studio-menu"
            style={{
              insetInlineStart: position?.x ?? 0,
              insetBlockStart: position?.y ?? 0,
              visibility: position === null ? 'hidden' : undefined,
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !button.current?.contains(event.relatedTarget)
              )
                close(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
              }
              if (event.key === 'Tab') {
                close(true);
                return;
              }
              moveFocus(event);
            }}
          >
            {items.map((item) => (
              <Fragment key={item.label}>
                {item.separated === true && <hr className="studio-menu-separator" />}
                <button
                  type="button"
                  role="menuitem"
                  aria-description={item.description}
                  disabled={item.disabled}
                  onClick={() => {
                    close(true);
                    item.action();
                  }}
                >
                  {item.icon !== undefined && (
                    <span aria-hidden="true" className="studio-menu-icon">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint !== undefined && (
                    <span aria-hidden="true" className="studio-menu-hint">
                      {item.hint}
                    </span>
                  )}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
