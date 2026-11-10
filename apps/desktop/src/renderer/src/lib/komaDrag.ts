import { reorderKoma } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/**
 * Geometry, wording and the drop action for reordering Komas by dragging in
 * the strip. The drop applies the same `reorderKoma` command as the move
 * buttons, so undo, transitions and saved state behave identically.
 */

/** Pointer travel, in CSS pixels, before a press on a Koma becomes a drag rather than a click. */
export const DRAG_START_DISTANCE = 5;

/** Distance from either end of the strip, in CSS pixels, that scrolls it during a drag. */
export const AUTO_SCROLL_EDGE = 48;

/** Largest scroll step per animation frame while the pointer is at the strip's very edge. */
export const AUTO_SCROLL_MAX_STEP = 14;

export function exceedsDragStartDistance(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_START_DISTANCE;
}

/**
 * The gap the pointer points at: 0 is before the first Koma, `midlines.length`
 * after the last. `midlines` are the centres of the Komas along the strip, in deck order.
 */
export function getDropInsertion(midlines: readonly number[], y: number): number {
  const index = midlines.findIndex((midline) => y < midline);
  return index === -1 ? midlines.length : index;
}

/**
 * The relative move for `reorderKoma` that places the Koma at index `from`
 * into gap `insertion`. Both gaps beside the Koma leave it in place (0).
 */
export function getDropOffset(from: number, insertion: number): number {
  const to = insertion > from ? insertion - 1 : insertion;
  return to - from;
}

/**
 * Scroll step for one frame: negative near the start edge (top or left), positive
 * near the end edge, else 0. The strip scrolls only in the direction the pointer has
 * travelled from `originY`, so a drag that starts near an edge stays put.
 */
export function getAutoScrollStep(y: number, originY: number, top: number, bottom: number): number {
  if (bottom - top <= AUTO_SCROLL_EDGE * 2) return 0;
  const step = (depth: number): number =>
    Math.ceil((Math.min(depth, AUTO_SCROLL_EDGE) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX_STEP);
  if (y < originY && y < top + AUTO_SCROLL_EDGE) return -step(top + AUTO_SCROLL_EDGE - y);
  if (y > originY && y > bottom - AUTO_SCROLL_EDGE) return step(y - (bottom - AUTO_SCROLL_EDGE));
  return 0;
}

/** Live-region text after a drag ends. Positions are 1-based. */
export function describeDragResult(from: number, offset: number | null): string {
  const number = String(from + 1);
  if (offset === null) return `Move cancelled. Koma ${number} stays at position ${number}.`;
  if (offset === 0) return `Koma ${number} stays at position ${number}.`;
  return `Koma ${number} moved to position ${String(from + offset + 1)}.`;
}

/**
 * Moves the dragged Koma into gap `insertion` of the current deck and selects
 * it. Dropping it beside itself changes nothing and records no undo step.
 * Returns its position before the drop and the applied offset, or null when
 * the Koma is no longer in the deck.
 */
export function dropKoma(
  komaId: string,
  insertion: number,
): { readonly from: number; readonly offset: number } | null {
  const project = selectProject(useProjectStore.getState());
  const from = project?.presentation.komas.findIndex((koma) => koma.id === komaId) ?? -1;
  if (from < 0) return null;
  const offset = getDropOffset(from, insertion);
  if (offset !== 0) useProjectStore.getState().apply(reorderKoma(komaId, offset));
  useUiStore.getState().selectKoma(komaId);
  return { from, offset };
}
