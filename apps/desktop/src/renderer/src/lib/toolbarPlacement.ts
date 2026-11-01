/** Edges of a rectangle in window coordinates. */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ToolbarPlacement {
  readonly x: number;
  readonly y: number;
  /** Where the toolbar sits relative to the selection. */
  readonly side: 'above' | 'below' | 'inside';
}

/** Space between the toolbar and the area edge. */
export const TOOLBAR_MARGIN = 8;
/** Space between the toolbar and the selection. */
export const TOOLBAR_GAP = 10;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function overlapArea(first: Edges, second: Edges): number {
  return (
    Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left)) *
    Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
  );
}

/**
 * Places the element toolbar centred above the selection. At the top edge it
 * moves below. When both fit, prefer the side covering less neighboring
 * content, so a nearby object remains available for clicking and dragging.
 * When neither fits, it stays inside the visible area over the selection.
 * It never leaves `area`, so controls near an edge stay usable.
 */
export function placeToolbar(
  target: Edges,
  area: Edges,
  size: { readonly width: number; readonly height: number },
  neighbors: readonly Edges[] = [],
): ToolbarPlacement {
  const minX = area.left + TOOLBAR_MARGIN;
  const maxX = area.right - TOOLBAR_MARGIN - size.width;
  const minY = area.top + TOOLBAR_MARGIN;
  const maxY = area.bottom - TOOLBAR_MARGIN - size.height;
  const x = Math.round(clamp((target.left + target.right - size.width) / 2, minX, maxX));
  const above = target.top - TOOLBAR_GAP - size.height;
  const below = target.bottom + TOOLBAR_GAP;
  const candidates: ToolbarPlacement[] = [];
  if (above >= minY && above <= maxY) candidates.push({ x, y: Math.round(above), side: 'above' });
  if (below >= minY && below <= maxY) candidates.push({ x, y: Math.round(below), side: 'below' });
  let best: ToolbarPlacement | undefined;
  let leastOverlap = Infinity;
  for (const candidate of candidates) {
    const bounds = {
      left: candidate.x,
      top: candidate.y,
      right: candidate.x + size.width,
      bottom: candidate.y + size.height,
    };
    const overlap = neighbors.reduce((total, neighbor) => total + overlapArea(bounds, neighbor), 0);
    if (overlap < leastOverlap) {
      best = candidate;
      leastOverlap = overlap;
    }
  }
  if (best !== undefined) return best;
  return { x, y: Math.round(clamp(target.top + TOOLBAR_MARGIN, minY, maxY)), side: 'inside' };
}
