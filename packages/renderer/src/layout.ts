import { COORDINATE_LIMIT, type KomaElement, type Position, type Size } from '@koma-motion/core';

export interface CanvasRect extends Size {
  readonly left: number;
  readonly top: number;
}

/** Keep even rotated/off-canvas text reachable, preserving its box whenever it fits. */
export function textEditorBox(element: KomaElement, canvas: Size, scale: number): CanvasRect {
  const stageWidth = canvas.width * scale;
  const stageHeight = canvas.height * scale;
  let width = Math.max(32, element.size.width * scale);
  let height = Math.max(32, element.size.height * scale);
  const angle = (element.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const fit = Math.min(
    1,
    stageWidth / (width * c + height * s),
    stageHeight / (width * s + height * c),
  );
  width *= fit;
  height *= fit;
  const halfWidth = (width * c + height * s) / 2;
  const halfHeight = (width * s + height * c) / 2;
  const centerX = Math.max(
    halfWidth,
    Math.min(stageWidth - halfWidth, (element.position.x + element.size.width / 2) * scale),
  );
  const centerY = Math.max(
    halfHeight,
    Math.min(stageHeight - halfHeight, (element.position.y + element.size.height / 2) * scale),
  );
  return { left: centerX - width / 2, top: centerY - height / 2, width, height };
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

/** Rotates an element by the angle swept around its centre. */
export function rotateElement(
  element: KomaElement,
  start: Position,
  current: Position,
): KomaElement {
  const centre = {
    x: element.position.x + element.size.width / 2,
    y: element.position.y + element.size.height / 2,
  };
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  const currentAngle = Math.atan2(current.y - centre.y, current.x - centre.x);
  let delta = currentAngle - startAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return {
    ...element,
    rotation: Math.max(-3600, Math.min(3600, element.rotation + (delta * 180) / Math.PI)),
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
