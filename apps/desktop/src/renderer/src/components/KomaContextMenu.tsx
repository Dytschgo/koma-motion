import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

export interface KomaMenuAnchor {
  readonly komaId: string;
  readonly x: number;
  readonly y: number;
  readonly source: HTMLButtonElement;
}

export interface KomaMenuItem {
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly action: () => void;
}

export function KomaContextMenu({
  anchor,
  items,
  onClose,
}: {
  readonly anchor: KomaMenuAnchor;
  readonly items: readonly KomaMenuItem[];
  readonly onClose: (restoreFocus: boolean) => void;
}): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });
  useLayoutEffect(() => {
    const rect = menu.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPosition({
      x: Math.max(8, Math.min(anchor.x, innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(anchor.y, innerHeight - rect.height - 8)),
    });
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose(false);
    };
    const reposition = (): void => onClose(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Koma actions"
      className="koma-context-menu"
      style={{ insetInlineStart: position.x, insetBlockStart: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          onClose(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
          return;
        }
        if (event.key === 'Tab') {
          onClose(true);
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const choices = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
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
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose(true);
            item.action();
          }}
        >
          <span>{item.label}</span>
          <span aria-hidden="true" className="koma-menu-shortcut">
            {item.shortcut}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
