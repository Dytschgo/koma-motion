import type { KomaElement, Position, Size } from '@koma-motion/core';
import type { Frame } from '@koma-motion/motion-engine';
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from 'react';
import type { AssetResolver } from './assets';
import { ElementView, getBoxStyle } from './ElementView';
import { CanvasTextEditor } from './CanvasTextEditor';
import {
  containsPointer,
  moveElement,
  pointerToLogical,
  resizeElement,
  type CanvasRect,
  type ResizeCorner,
} from './layout';

export interface KomaStageProps {
  readonly frame: Frame;
  readonly canvasSize: Size;
  readonly scale: number;
  readonly resolveAsset: AssetResolver;
  readonly label: string;
  readonly selectedElementId?: string | null;
  readonly onSelectElement?: ((elementId: string | null) => void) | undefined;
  /** Only committed edits leave the stage; pointer and text drafts are disposable. */
  readonly onCommitElement?: ((element: KomaElement) => void) | undefined;
}
interface Gesture {
  readonly pointerId: number;
  readonly source: Frame;
  readonly original: KomaElement;
  readonly start: Position;
  readonly rect: CanvasRect;
  readonly captureTarget: HTMLElement;
  readonly corner?: ResizeCorner | undefined;
}
const controlStyle: CSSProperties = {
  background: '#182230',
  color: '#fff',
  border: '1px solid #8394aa',
  borderRadius: 4,
  padding: '4px 8px',
  font: '13px system-ui',
  cursor: 'pointer',
};

/** Draws the model, with optional editing controls absent from previews and thumbnails. */
export function KomaStage({
  frame,
  canvasSize,
  scale,
  resolveAsset,
  label,
  selectedElementId = null,
  onSelectElement,
  onCommitElement,
}: KomaStageProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<{ source: Frame; element: KomaElement } | null>(null);
  const [textDraft, setTextDraft] = useState<{ source: Frame; id: string } | null>(null);
  const interactive = onSelectElement !== undefined;
  const editable = interactive && onCommitElement !== undefined;
  const selected = frame.layers.find((layer) => layer.element.id === selectedElementId)?.element;
  const textEditing =
    editable && textDraft?.source === frame && textDraft.id === selectedElementId
      ? textDraft
      : null;
  // Invalidate the session permanently; selecting the old element again must not revive it.
  if (textDraft !== null && textEditing === null) setTextDraft(null);
  const shown =
    editable && draft?.source === frame && draft.element.id === selectedElementId
      ? draft.element
      : selected;
  const restoreFocus = (): void => {
    stage.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.focus({ preventScroll: true });
  };
  const cancel = (): void => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.captureTarget.hasPointerCapture(active.pointerId))
      active.captureTarget.releasePointerCapture(active.pointerId);
    setDraft(null);
    setTextDraft(null);
    restoreFocus();
  };
  const editText = (): void => {
    if (editable && selected?.type === 'text' && !selected.locked) {
      gesture.current = null;
      setDraft(null);
      setTextDraft({ source: frame, id: selected.id });
    }
  };
  const closeText = (focus: boolean): void => {
    setTextDraft(null);
    if (focus) restoreFocus();
  };
  const begin = (
    event: PointerEvent<HTMLElement>,
    element: KomaElement,
    corner?: ResizeCorner,
  ): void => {
    event.stopPropagation();
    if (
      !editable ||
      element.locked ||
      textEditing !== null ||
      event.button !== 0 ||
      gesture.current !== null
    )
      return;
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      source: frame,
      original: element,
      rect,
      captureTarget: event.currentTarget,
      start: pointerToLogical({ x: event.clientX, y: event.clientY }, rect, canvasSize),
      corner,
    };
  };
  const nextElement = (event: PointerEvent<HTMLDivElement>): KomaElement | null => {
    const active = gesture.current;
    const rect = stage.current?.getBoundingClientRect();
    if (
      !editable ||
      !active ||
      active.pointerId !== event.pointerId ||
      active.source !== frame ||
      !rect ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return null;
    // A fit/zoom/layout change invalidates the gesture's coordinate space.
    if (
      rect.width !== active.rect.width ||
      rect.height !== active.rect.height ||
      rect.left !== active.rect.left ||
      rect.top !== active.rect.top
    ) {
      cancel();
      return null;
    }
    const point = pointerToLogical({ x: event.clientX, y: event.clientY }, rect, canvasSize);
    const delta = { x: point.x - active.start.x, y: point.y - active.start.y };
    return active.corner
      ? resizeElement(active.original, delta, active.corner)
      : moveElement(active.original, delta);
  };
  return (
    <div
      ref={stage}
      data-koma-stage=""
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      tabIndex={interactive ? -1 : undefined}
      style={{
        position: 'relative',
        width: canvasSize.width * scale,
        height: canvasSize.height * scale,
        overflow: 'hidden',
        background: frame.background.colour,
        flex: 'none',
        touchAction: interactive ? 'none' : undefined,
      }}
      onPointerDown={
        interactive
          ? () => {
              cancel();
              onSelectElement(null);
              stage.current?.focus();
            }
          : undefined
      }
      onPointerMove={(event) => {
        const element = nextElement(event);
        if (element) setDraft({ source: frame, element });
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        if (active?.pointerId !== event.pointerId) return;
        const element = nextElement(event);
        const rect = stage.current?.getBoundingClientRect();
        gesture.current = null;
        setDraft(null);
        if (active.captureTarget.hasPointerCapture(event.pointerId))
          active.captureTarget.releasePointerCapture(event.pointerId);
        if (
          element &&
          rect &&
          containsPointer({ x: event.clientX, y: event.clientY }, rect) &&
          JSON.stringify(element) !== JSON.stringify(active.original)
        )
          onCommitElement?.(element);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        gesture.current = null;
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div
        aria-hidden={interactive ? undefined : true}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvasSize.width,
          height: canvasSize.height,
          transform: `scale(${String(scale)})`,
          transformOrigin: '0 0',
          isolation: 'isolate',
        }}
      >
        {frame.layers.map((layer) => (
          <ElementView
            key={layer.key}
            element={shown?.id === layer.element.id ? shown : layer.element}
            resolveAsset={resolveAsset}
            selected={interactive && layer.element.id === selectedElementId}
            editingText={textEditing?.id === layer.element.id}
            outlineWidth={scale > 0 ? 2 / scale : 2}
            onSelect={onSelectElement}
            onManipulate={begin}
            onEditText={layer.element.id === selectedElementId ? editText : undefined}
            onElementKeyDown={(event, element) => {
              if (
                !editable ||
                element.locked ||
                element.id !== selectedElementId ||
                textEditing ||
                gesture.current
              )
                return;
              if (event.key === 'Enter' && element.type === 'text') {
                event.preventDefault();
                editText();
                return;
              }
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const step = event.shiftKey ? 10 : 1;
              const delta = {
                ArrowLeft: { x: -step, y: 0 },
                ArrowRight: { x: step, y: 0 },
                ArrowUp: { x: 0, y: -step },
                ArrowDown: { x: 0, y: step },
              }[event.key];
              if (delta) {
                event.preventDefault();
                event.stopPropagation();
                onCommitElement?.(moveElement(element, delta));
              }
            }}
          />
        ))}
      </div>
      {editable && shown && !shown.locked && !textEditing && (
        <div
          style={{
            ...getBoxStyle(shown),
            left: shown.position.x * scale,
            top: shown.position.y * scale,
            width: shown.size.width * scale,
            height: shown.size.height * scale,
            opacity: 1,
            zIndex: 20001,
            pointerEvents: 'none',
          }}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <button
              key={corner}
              type="button"
              aria-label={`Resize ${shown.name} ${corner}`}
              // Pointer only: the keyboard sets the size in the Inspector.
              tabIndex={-1}
              title="Drag to resize. Width and height are also in the Inspector."
              onPointerDown={(event) => begin(event, shown, corner)}
              style={{
                position: 'absolute',
                width: 12,
                height: 12,
                padding: 0,
                border: '2px solid #FF5A36',
                background: '#fff',
                pointerEvents: 'auto',
                touchAction: 'none',
                left: corner.endsWith('w') ? 0 : undefined,
                right: corner.endsWith('e') ? 0 : undefined,
                top: corner.startsWith('n') ? 0 : undefined,
                bottom: corner.startsWith('s') ? 0 : undefined,
                cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
              }}
            />
          ))}
        </div>
      )}
      {textEditing && selected?.type === 'text' && onCommitElement && (
        <CanvasTextEditor
          element={selected}
          canvasSize={canvasSize}
          scale={scale}
          background={frame.background.colour}
          onCommit={onCommitElement}
          onClose={closeText}
        />
      )}
      {editable && selected?.type === 'text' && !selected.locked && !textEditing && (
        <div
          role="group"
          aria-label="Canvas text editing"
          onPointerDown={(event) => event.stopPropagation()}
          style={{ position: 'absolute', right: 8, top: 8, zIndex: 20002, display: 'flex', gap: 6 }}
        >
          <button type="button" style={controlStyle} onClick={editText}>
            Edit text
          </button>
        </div>
      )}
    </div>
  );
}
