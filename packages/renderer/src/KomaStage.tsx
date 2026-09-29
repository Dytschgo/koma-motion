import type { Size } from '@koma-motion/core';
import type { Frame } from '@koma-motion/motion-engine';
import type { ReactElement } from 'react';
import type { AssetResolver } from './assets';
import { ElementView } from './ElementView';

export interface KomaStageProps {
  /** What to draw: a Koma at rest or an interpolated frame of a transition. */
  readonly frame: Frame;
  /** Size of the logical canvas. */
  readonly canvasSize: Size;
  /** CSS pixels per logical unit. */
  readonly scale: number;
  readonly resolveAsset: AssetResolver;
  readonly label: string;
  readonly selectedElementId?: string | null;
  /**
   * When given, elements can be selected. It is called with `null` when the
   * empty canvas is chosen.
   */
  readonly onSelectElement?: ((elementId: string | null) => void) | undefined;
}

/**
 * Draws a frame on a canvas of fixed aspect ratio. The stage only displays
 * the document model: it holds no document state of its own.
 */
export function KomaStage({
  frame,
  canvasSize,
  scale,
  resolveAsset,
  label,
  selectedElementId = null,
  onSelectElement,
}: KomaStageProps): ReactElement {
  const interactive = onSelectElement !== undefined;
  return (
    <div
      data-koma-stage=""
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      style={{
        position: 'relative',
        width: canvasSize.width * scale,
        height: canvasSize.height * scale,
        overflow: 'hidden',
        background: frame.background.colour,
        flex: 'none',
      }}
      onPointerDown={
        interactive
          ? () => {
              onSelectElement(null);
            }
          : undefined
      }
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
            element={layer.element}
            resolveAsset={resolveAsset}
            selected={layer.element.id === selectedElementId}
            outlineWidth={scale > 0 ? 2 / scale : 2}
            onSelect={onSelectElement}
          />
        ))}
      </div>
    </div>
  );
}
