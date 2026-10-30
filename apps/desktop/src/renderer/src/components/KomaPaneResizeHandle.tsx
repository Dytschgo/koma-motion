import { useRef, type ReactElement } from 'react';
import { clampKomaPaneWidth, KOMA_PANE_DEFAULT_WIDTH, KOMA_PANE_MIN_WIDTH } from '../lib/komaPane';

export function KomaPaneResizeHandle({
  width,
  maximum,
  controls,
  onResize,
  onCollapse,
}: {
  readonly width: number;
  readonly maximum: number;
  readonly controls: string;
  readonly onResize: (width: number) => void;
  readonly onCollapse: () => void;
}): ReactElement {
  const press = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const resize = (value: number): void => onResize(clampKomaPaneWidth(value, maximum));
  const end = (): void => {
    press.current = null;
  };
  return (
    <div
      role="separator"
      aria-label="Resize Koma thumbnails"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={KOMA_PANE_MIN_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${String(width)} pixels wide`}
      tabIndex={0}
      title="Drag to resize thumbnails. Drag to the left edge to collapse. Double-click to reset."
      className="koma-pane-resize"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { pointerId: event.pointerId, x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (current?.pointerId !== event.pointerId) return;
        const next = current.width + event.clientX - current.x;
        if (next < KOMA_PANE_MIN_WIDTH / 2) {
          end();
          onCollapse();
        } else resize(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => resize(KOMA_PANE_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        const next =
          event.key === 'ArrowRight'
            ? width + step
            : event.key === 'ArrowLeft'
              ? width - step
              : event.key === 'Home'
                ? KOMA_PANE_MIN_WIDTH
                : event.key === 'End'
                  ? maximum
                  : null;
        if (next !== null) {
          event.preventDefault();
          resize(next);
        }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
