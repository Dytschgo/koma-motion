import type { Size } from '@koma-motion/core';

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
