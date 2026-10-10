import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  describeDragResult,
  dropKoma,
  exceedsDragStartDistance,
  getAutoScrollStep,
  getDropInsertion,
} from './komaDrag';

/** Marks each Koma item in the strip, in deck order, as a drop reference. */
const ITEM_SELECTOR = '[data-koma-drag-item]';

export interface KomaDragState {
  readonly komaId: string;
  readonly from: number;
  /** The gap the Koma would be dropped into: 0 is before the first Koma. */
  readonly insertion: number;
}

interface Press {
  readonly komaId: string;
  readonly from: number;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly element: HTMLElement;
  dragging: boolean;
}

export interface KomaDragHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Pointer handling for dragging Komas within the scrollable strip `container`.
 * A press becomes a drag after a short travel, so a click still selects.
 * Escape cancels; the strip scrolls near its edges. The drop is `dropKoma`.
 */
export function useKomaDrag(
  container: RefObject<HTMLElement | null>,
  count: number,
): {
  readonly drag: KomaDragState | null;
  readonly announcement: string;
  readonly handlers: (komaId: string, index: number) => KomaDragHandlers;
} {
  const [drag, setDrag] = useState<KomaDragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const press = useRef<Press | null>(null);
  const pointerY = useRef(0);
  const suppressClick = useRef(false);

  const insertionAt = useCallback(
    (y: number): number => {
      const items = container.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [];
      const midlines = Array.from(items, (item) => {
        const rect = item.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      return getDropInsertion(midlines, y);
    },
    [container],
  );

  const track = useCallback(
    (current: Press, y: number): void => {
      const insertion = insertionAt(y);
      setDrag((previous) =>
        previous?.komaId === current.komaId && previous.insertion === insertion
          ? previous
          : { komaId: current.komaId, from: current.from, insertion },
      );
    },
    [insertionAt],
  );

  /** Ends a press. A drag is dropped into `insertion`, or cancelled when it is null. */
  const end = useCallback((insertion: number | null): void => {
    const current = press.current;
    press.current = null;
    if (current === null) return;
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    if (!current.dragging) return;
    suppressClick.current = true;
    setDrag(null);
    const result = insertion === null ? null : dropKoma(current.komaId, insertion);
    setAnnouncement(
      result === null
        ? describeDragResult(current.from, null)
        : describeDragResult(result.from, result.offset),
    );
  }, []);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const scroll = (): void => {
      const element = container.current;
      const current = press.current;
      if (element !== null && current !== null) {
        const rect = element.getBoundingClientRect();
        const step = getAutoScrollStep(pointerY.current, current.y, rect.top, rect.bottom);
        const before = element.scrollTop;
        if (step !== 0) element.scrollTop += step;
        if (element.scrollTop !== before) track(current, pointerY.current);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      end(null);
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', cancelOnEscape, true);
    };
  }, [dragging, container, end, track]);

  const handlers = (komaId: string, index: number): KomaDragHandlers => ({
    onPointerDown(event) {
      suppressClick.current = false;
      if (event.button !== 0 || count < 2 || press.current !== null) return;
      press.current = {
        komaId,
        from: index,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: event.currentTarget,
        dragging: false,
      };
    },
    onPointerMove(event) {
      const current = press.current;
      if (current?.pointerId !== event.pointerId) return;
      pointerY.current = event.clientY;
      if (!current.dragging) {
        if (!exceedsDragStartDistance(event.clientX - current.x, event.clientY - current.y)) return;
        current.dragging = true;
        current.element.setPointerCapture(event.pointerId);
        window.getSelection()?.removeAllRanges();
      }
      track(current, event.clientY);
    },
    onPointerUp(event) {
      if (press.current?.pointerId !== event.pointerId) return;
      end(insertionAt(event.clientY));
    },
    onPointerCancel(event) {
      if (press.current?.pointerId === event.pointerId) end(null);
    },
    onLostPointerCapture(event) {
      if (press.current?.pointerId === event.pointerId) end(null);
    },
    onClickCapture(event) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { drag, announcement, handlers };
}
