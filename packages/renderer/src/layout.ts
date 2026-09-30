import { COORDINATE_LIMIT, type KomaElement, type Position, type Size } from '@koma-motion/core';

export interface CanvasRect extends Size {
  readonly left: number;
  readonly top: number;
}

/** Uses the measured viewport rect, including fit, zoom and ancestor transforms. */
export function pointerToLogical(point: Position, rect: CanvasRect, canvas: Size): Position {
  return {
    x: ((point.x - rect.left) * canvas.width) / rect.width,
    y: ((point.y - rect.top) * canvas.height) / rect.height,
  };
}

export function containsPointer(point: Position, rect: CanvasRect): boolean {
  return (
    point.x >= rect.left &&
    point.y >= rect.top &&
    point.x <= rect.left + rect.width &&
    point.y <= rect.top + rect.height
  );
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const bound = (value: number): number =>
  Math.max(-COORDINATE_LIMIT, Math.min(COORDINATE_LIMIT, value));

export function moveElement(element: KomaElement, delta: Position): KomaElement {
  return {
    ...element,
    position: { x: bound(element.position.x + delta.x), y: bound(element.position.y + delta.y) },
  };
}

/** Resizes in the element's rotated axes, keeping the opposite corner fixed. */
export function resizeElement(
  element: KomaElement,
  delta: Position,
  corner: ResizeCorner,
): KomaElement {
  const angle = (element.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const sx = corner.endsWith('e') ? 1 : -1,
    sy = corner.startsWith('s') ? 1 : -1;
  const minHeight = element.type === 'shape' && element.content.shape === 'line' ? 1 : 24;
  const width = Math.min(
    COORDINATE_LIMIT,
    Math.max(24, element.size.width + sx * (c * delta.x + s * delta.y)),
  );
  const height = Math.min(
    COORDINATE_LIMIT,
    Math.max(minHeight, element.size.height + sy * (-s * delta.x + c * delta.y)),
  );
  const dx = ((width - element.size.width) * sx) / 2,
    dy = ((height - element.size.height) * sy) / 2;
  return {
    ...element,
    size: { width, height },
    position: {
      x: bound(element.position.x + c * dx - s * dy - (width - element.size.width) / 2),
      y: bound(element.position.y + s * dx + c * dy - (height - element.size.height) / 2),
    },
  };
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * CSS pixels per logical unit at which the whole canvas fits into the
 * available area while keeping its aspect ratio.
 */
export function getFitScale(canvas: Size, available: Size, padding = 0): number {
  const width = Math.max(0, available.width - padding * 2);
  const height = Math.max(0, available.height - padding * 2);
  if (canvas.width <= 0 || canvas.height <= 0) {
    return 0;
  }
  return Math.min(width / canvas.width, height / canvas.height);
}
