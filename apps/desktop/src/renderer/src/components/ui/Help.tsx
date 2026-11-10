import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { join } from './internal';

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
