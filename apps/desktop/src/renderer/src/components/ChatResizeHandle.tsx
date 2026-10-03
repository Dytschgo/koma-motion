import { useRef, useState, type ReactElement } from 'react';
import {
  CHAT_DEFAULT_WIDTH,
  CHAT_MIN_WIDTH,
  CHAT_RESIZE_STEP,
  clampChatWidth,
} from '../lib/chatLayout';

/**
 * The vertical divider on the left edge of the chat. It is a focusable window
 * splitter: drag it, or use the arrow keys, Home and End. Double-click
 * restores the default width.
 */
export function ChatResizeHandle({
  width,
  maxWidth,
  controls,
  onResize,
}: {
  readonly width: number;
  readonly maxWidth: number;
  readonly controls: string;
  readonly onResize: (width: number) => void;
}): ReactElement {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const resize = (next: number): void => {
    onResize(clampChatWidth(next, maxWidth));
  };
  const endDrag = (): void => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat"
      aria-controls={controls}
      aria-valuemin={CHAT_MIN_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={`${String(width)} pixels wide`}
      tabIndex={0}
      title="Drag to resize the chat. Double-click to restore the default width."
      data-dragging={dragging ? '' : undefined}
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none focus-visible:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        // Keeps the drag from selecting text in the conversation.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId === event.pointerId) {
          // The chat is on the right: moving the divider left makes it wider.
          resize(current.startWidth + current.startX - event.clientX);
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => {
        resize(CHAT_DEFAULT_WIDTH);
      }}
      onKeyDown={(event) => {
        const step = CHAT_RESIZE_STEP * (event.shiftKey ? 4 : 1);
        const next =
          event.key === 'ArrowLeft'
            ? width + step
            : event.key === 'ArrowRight'
              ? width - step
              : event.key === 'Home'
                ? CHAT_MIN_WIDTH
                : event.key === 'End'
                  ? maxWidth
                  : null;
        if (next !== null) {
          event.preventDefault();
          resize(next);
        }
      }}
    >
      <span
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ' +
          'group-hover:bg-line-strong group-focus-visible:w-1 group-focus-visible:bg-accent ' +
          'group-data-dragging:bg-accent'
        }
      />
    </div>
  );
}
